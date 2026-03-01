import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

/**
 * GET /api/coingecko/[...path]
 * Proxies CoinGecko API requests for XAUT (Tether Gold) price data.
 * Used by GoldPriceChart for 24/7 gold price tracking.
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
    // Extract the path after /api/coingecko/
    const pathMatch = url.pathname.match(/^\/api\/coingecko\/(.+)$/);
    if (!pathMatch) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const apiPath = pathMatch[1];
    const coingeckoUrl = `https://api.coingecko.com/${apiPath}${url.search}`;

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
        'Content-Type': response.headers.get('content-type') || 'application/json',
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
    console.error('[coingecko] Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch from CoinGecko' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
