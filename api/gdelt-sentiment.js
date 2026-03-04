// GDELT Sentiment API proxy for Gold price news sentiment
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

// Pin to US East - GDELT may block certain regions
export const config = { runtime: 'edge', regions: ['iad1'] };

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
    // Default query for Gold-related news - normalized for better cache hits
    const url = new URL(request.url);
    const rawQuery = url.searchParams.get('query');
    
    // Canonical default query - use this if no custom query provided
    const DEFAULT_QUERY = 'gold OR XAUUSD OR "gold price" OR geopolitical OR "Federal Reserve" OR inflation';
    
    // Normalize query: lowercase, trim, use default if empty/similar
    let query = rawQuery?.trim() || DEFAULT_QUERY;
    
    // Normalize common variations to canonical form for better cache hits
    const normalizedCheck = query.toLowerCase().replace(/\s+/g, ' ');
    if (
      normalizedCheck.includes('gold') && 
      normalizedCheck.includes('xauusd') &&
      !rawQuery // Only normalize if using default-ish query
    ) {
      query = DEFAULT_QUERY;
    }
    
    // Normalize maxrecords to common values for better cache hits
    const rawMaxRecords = parseInt(url.searchParams.get('maxrecords') || '30', 10);
    // Bucket to common values: 10, 30, 50 (reduces cache key variants)
    const maxRecords = rawMaxRecords <= 15 ? '10' : rawMaxRecords <= 40 ? '30' : '50';
    
    // Build GDELT DOC API URL
    const gdeltUrl = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    gdeltUrl.searchParams.set('query', query);
    gdeltUrl.searchParams.set('mode', 'artlist');
    gdeltUrl.searchParams.set('maxrecords', maxRecords);
    gdeltUrl.searchParams.set('format', 'json');
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // Increased timeout
    
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
          'Cache-Control': 'public, max-age=900, s-maxage=1800, stale-while-revalidate=600', // 30 min CDN cache
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('[GDELT Sentiment] Error:', error.message);
    
    // Return empty but valid response so frontend can use fallback
    // Cache errors too to prevent repeated failed calls
    return new Response(JSON.stringify({ 
      articles: [],
      error: error.message 
    }), {
      status: 200, // Return 200 with empty data so frontend handles gracefully
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=600', // Cache errors for 10 min on CDN
      },
    });
  }
}
