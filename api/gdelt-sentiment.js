// GDELT Sentiment API proxy for Gold price news sentiment
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

/**
 * Proxy requests to GDELT DOC 2.0 API for real-time news sentiment
 * Used by the Gold price chart to analyze breaking news impact
 */
export default async function handler(request) {
  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  
  if (isDisallowedOrigin(origin)) {
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }
  
  try {
    // Default query for Gold-related news
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || 
      'gold OR XAUUSD OR "gold price" OR geopolitical OR "Federal Reserve" OR inflation';
    const maxRecords = url.searchParams.get('maxrecords') || '30';
    
    // Build GDELT DOC API URL
    const gdeltUrl = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    gdeltUrl.searchParams.set('query', query);
    gdeltUrl.searchParams.set('mode', 'artlist');
    gdeltUrl.searchParams.set('maxrecords', maxRecords);
    gdeltUrl.searchParams.set('format', 'json');
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch(gdeltUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'GoldTraderMonitor/1.0',
          'Accept': 'application/json',
        },
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`GDELT API returned ${response.status}`);
      }
      
      const data = await response.json();
      
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('[GDELT Sentiment] Error:', error.message);
    
    // Return empty but valid response so frontend can use fallback
    return new Response(JSON.stringify({ 
      articles: [],
      error: error.message 
    }), {
      status: 200, // Return 200 with empty data so frontend handles gracefully
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }
}
