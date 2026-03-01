import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

/**
 * GET /api/yahoo-gold
 * Fetches gold futures (GC=F) chart data from Yahoo Finance.
 * Query params:
 *   - interval: 1m, 5m, 15m, 30m, 1h, 1d (default: 1h)
 *   - range: 1d, 5d, 1mo, 3mo, 6mo, 1y (default: 5d)
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

  try {
    const url = new URL(req.url);
    const interval = url.searchParams.get('interval') || '1h';
    const range = url.searchParams.get('range') || '5d';

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${interval}&range=${range}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(yahooUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, s-maxage=120',
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
    console.error('[yahoo-gold] Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch from Yahoo Finance' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
