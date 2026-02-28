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
 * GET /api/gold-price
 * Proxies Alpha Vantage XAUUSD intraday data to client.
 * Query params:
 *   - interval: '1min' | '5min' | '15min' | '30min' | '60min' (default: '1min')
 *   - outputsize: 'compact' | 'full' (default: 'compact' = last 100 data points)
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

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ALPHA_VANTAGE_API_KEY is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const interval = url.searchParams.get('interval') || '1min';
  const outputsize = url.searchParams.get('outputsize') || 'compact';

  // Validate interval
  const validIntervals = ['1min', '5min', '15min', '30min', '60min'];
  if (!validIntervals.includes(interval)) {
    return new Response(JSON.stringify({ error: `Invalid interval. Use one of: ${validIntervals.join(', ')}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const alphaVantageUrl = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=XAU&to_symbol=USD&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;

  try {
    const response = await fetchWithTimeout(alphaVantageUrl, {
      headers: { 'User-Agent': 'GoldTrader/1.0' },
    });

    if (!response.ok) {
      console.error('[gold-price] Alpha Vantage error:', response.status, response.statusText);
      return new Response(JSON.stringify({ error: 'Failed to fetch gold price data' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await response.json();

    // Check for Alpha Vantage error messages
    if (data['Error Message']) {
      return new Response(JSON.stringify({ error: data['Error Message'] }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (data['Note']) {
      // Rate limit message
      return new Response(JSON.stringify({ error: 'API rate limit reached. Please try again later.', note: data['Note'] }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, s-maxage=30',
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error('[gold-price] Error:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch gold price data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
