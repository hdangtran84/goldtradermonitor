import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

/**
 * GET /api/coingecko-xaut
 * Fetches XAUT (Tether Gold) market chart data from CoinGecko.
 * Query params:
 *   - days: number of days to fetch (1, 7, 14, 30, etc.)
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
    const days = url.searchParams.get('days') || '1';

    const coingeckoUrl = `https://api.coingecko.com/api/v3/coins/tether-gold/market_chart?vs_currency=usd&days=${days}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(coingeckoUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GoldTrader/1.0',
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
    console.error('[coingecko-xaut] Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch from CoinGecko' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
