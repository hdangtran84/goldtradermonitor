import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

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
    const requestUrl = new URL(req.url);
    const endpoint = requestUrl.searchParams.get('endpoint') || 'markets';
    const closed = requestUrl.searchParams.get('closed') || 'false';
    const order = requestUrl.searchParams.get('order') || 'volume';
    const ascending = requestUrl.searchParams.get('ascending') || 'false';
    const limitParam = parseInt(requestUrl.searchParams.get('limit') || '50', 10);
    const limit = Math.max(1, Math.min(100, limitParam));

    const params = new URLSearchParams({
      closed,
      order,
      ascending,
      limit: String(limit),
    });

    // Add tag filter for events endpoint
    if (endpoint === 'events') {
      const tag = (requestUrl.searchParams.get('tag') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 100);
      if (tag) params.set('tag_slug', tag);
    }

    const gammaUrl = `${GAMMA_BASE}/${endpoint === 'events' ? 'events' : 'markets'}?${params}`;

    const response = await fetchWithTimeout(gammaUrl, {
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'GoldTrader/1.0',
      },
    }, 15000);

    if (!response.ok) {
      // Gamma API might be blocking - return empty array gracefully
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          ...corsHeaders,
        },
      });
    }

    const data = await response.text();
    
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=120',
        'X-Polymarket-Source': 'gamma',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    // Return empty array on error for graceful degradation
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        ...corsHeaders,
      },
    });
  }
}
