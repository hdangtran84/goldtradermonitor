import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET /api/fred-data
 * Proxies FRED (Federal Reserve Economic Data) series observations.
 * Query params:
 *   - series_id: FRED series ID (required, e.g., 'T10Y2Y', 'UNRATE', 'CPIAUCSL')
 *   - observation_start: Start date in YYYY-MM-DD format (optional)
 *   - observation_end: End date in YYYY-MM-DD format (optional)
 */
export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'FRED_API_KEY is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const seriesId = url.searchParams.get('series_id');
  const observationStart = url.searchParams.get('observation_start');
  const observationEnd = url.searchParams.get('observation_end');

  if (!seriesId) {
    return new Response(JSON.stringify({ error: 'series_id parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Build FRED API URL
  let fredUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
  
  if (observationStart) {
    fredUrl += `&observation_start=${encodeURIComponent(observationStart)}`;
  }
  if (observationEnd) {
    fredUrl += `&observation_end=${encodeURIComponent(observationEnd)}`;
  }

  try {
    const response = await fetchWithTimeout(fredUrl, {
      headers: { 'User-Agent': 'GoldTrader/1.0' },
    });

    if (!response.ok) {
      console.error('[fred-data] FRED API error:', response.status, response.statusText);
      return new Response(JSON.stringify({ error: 'Failed to fetch FRED data' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await response.json();

    // Check for FRED error messages
    if (data.error_code || data.error_message) {
      return new Response(JSON.stringify({ error: data.error_message || 'FRED API error' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        ...corsHeaders,
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Request timed out' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    console.error('[fred-data] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
