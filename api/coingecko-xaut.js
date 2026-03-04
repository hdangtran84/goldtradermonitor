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
    const rawDays = parseInt(url.searchParams.get('days') || '1', 10);
    
    // Normalize days to common buckets for better cache hits: 1, 7, 14, 30, 90, 365
    let days;
    if (rawDays <= 1) days = '1';
    else if (rawDays <= 7) days = '7';
    else if (rawDays <= 14) days = '14';
    else if (rawDays <= 30) days = '30';
    else if (rawDays <= 90) days = '90';
    else days = '365';

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
        'Cache-Control': 'public, max-age=180, s-maxage=600, stale-while-revalidate=300', // 10 min CDN, 3 min client
        ...corsHeaders,
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Request timed out', prices: [] }), {
        status: 200, // Return 200 so frontend degrades gracefully
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60, s-maxage=120', // Cache timeout errors briefly
          ...corsHeaders 
        },
      });
    }
    console.error('[coingecko-xaut] Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch from CoinGecko', prices: [] }), {
      status: 200, // Return 200 for graceful degradation
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, s-maxage=120', // Cache errors briefly
        ...corsHeaders 
      },
    });
  }
}
