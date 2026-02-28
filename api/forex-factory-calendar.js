// FXStreet Economic Calendar API
// Fetches high-impact USD events from FXStreet's public calendar API
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// Get gold price effect based on event name
function getGoldEffect(eventName) {
  const name = eventName.toLowerCase();
  
  // Hawkish/bearish for gold
  if (name.includes('interest rate') || name.includes('fed funds')) {
    return { direction: 'Rate hike = bearish, cut = bullish', sentiment: 'variable' };
  }
  if (name.includes('fomc') || name.includes('federal reserve')) {
    return { direction: 'Hawkish = bearish, Dovish = bullish', sentiment: 'variable' };
  }
  if (name.includes('nonfarm') || name.includes('non-farm') || name.includes('payroll')) {
    return { direction: 'Strong jobs = bearish for gold', sentiment: 'inverse' };
  }
  if (name.includes('cpi') || name.includes('inflation') || name.includes('consumer price')) {
    return { direction: 'High inflation = bullish for gold', sentiment: 'positive' };
  }
  if (name.includes('pce') || name.includes('core pce')) {
    return { direction: "Fed's preferred inflation gauge - key for rate path", sentiment: 'variable' };
  }
  if (name.includes('gdp')) {
    return { direction: 'Strong GDP = bearish for gold', sentiment: 'inverse' };
  }
  if (name.includes('unemployment') || name.includes('jobless claim')) {
    return { direction: 'High unemployment = bullish for gold', sentiment: 'positive' };
  }
  if (name.includes('retail sales') || name.includes('consumer spending')) {
    return { direction: 'Strong data = bearish for gold', sentiment: 'inverse' };
  }
  if (name.includes('ism') || name.includes('pmi') || name.includes('manufacturing')) {
    return { direction: 'Strong PMI = bearish for gold', sentiment: 'inverse' };
  }
  if (name.includes('housing') || name.includes('home sales') || name.includes('building permit')) {
    return { direction: 'Strong housing = bearish for gold', sentiment: 'inverse' };
  }
  if (name.includes('trade balance') || name.includes('trade deficit')) {
    return { direction: 'Trade deficit = mixed impact', sentiment: 'neutral' };
  }
  if (name.includes('durable goods')) {
    return { direction: 'Strong orders = bearish for gold', sentiment: 'inverse' };
  }
  if (name.includes('powell') || name.includes('fed chair') || name.includes('fed speak')) {
    return { direction: 'Watch for rate guidance, inflation outlook', sentiment: 'variable' };
  }
  
  return { direction: 'Monitor for USD impact', sentiment: 'neutral' };
}

// Map FXStreet volatility to our impact scale
function mapVolatility(volatility) {
  switch (volatility?.toUpperCase()) {
    case 'HIGH': return 'high';
    case 'MEDIUM': return 'medium';
    case 'LOW': return 'low';
    default: return 'low';
  }
}

export default async function handler(request) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  // Check origin
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { ...getCorsHeaders(request), 'Content-Type': 'application/json' },
    });
  }

  try {
    // Calculate date range: 2 days ago to 7 days ahead
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 2);
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 7);
    
    const formatDate = (d) => d.toISOString().split('T')[0];
    
    // Fetch from FXStreet's public calendar API
    const url = `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${formatDate(fromDate)}/${formatDate(toDate)}`;
    
    const response = await fetchWithTimeout(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://www.fxstreet.com',
        'Referer': 'https://www.fxstreet.com/',
      },
    });

    if (!response.ok) {
      throw new Error(`FXStreet API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid response format from FXStreet');
    }
    
    // Filter for USD high-impact events
    const now = new Date();
    const events = data
      .filter(e => e.currencyCode === 'USD' && e.volatility === 'HIGH')
      .map(e => ({
        id: e.id || `fxs-${e.eventId}-${e.dateUtc}`,
        name: e.name || 'Unknown Event',
        time: e.dateUtc,
        country: e.countryCode || 'US',
        currency: e.currencyCode || 'USD',
        impact: mapVolatility(e.volatility),
        actual: e.actual != null ? String(e.actual) + (e.unit || '') : undefined,
        forecast: e.consensus != null ? String(e.consensus) + (e.unit || '') : undefined,
        previous: e.previous != null ? String(e.previous) + (e.unit || '') : undefined,
        isBetterThanExpected: e.isBetterThanExpected,
        goldEffect: getGoldEffect(e.name || ''),
        source: 'fxstreet',
      }))
      .sort((a, b) => {
        const aTime = new Date(a.time);
        const bTime = new Date(b.time);
        const aIsPast = aTime < now;
        const bIsPast = bTime < now;
        
        if (aIsPast && !bIsPast) return 1;
        if (!aIsPast && bIsPast) return -1;
        if (aIsPast && bIsPast) return bTime.getTime() - aTime.getTime();
        return aTime.getTime() - bTime.getTime();
      });

    return new Response(JSON.stringify({
      events,
      total: data.length,
      highImpact: events.length,
      fetchedAt: new Date().toISOString(),
      source: 'fxstreet.com',
    }), {
      status: 200,
      headers: {
        ...getCorsHeaders(request),
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('[fxstreet-calendar] Error:', error.message);
    
    return new Response(JSON.stringify({
      error: error.message || 'Failed to fetch calendar',
      events: [],
      fallback: true,
    }), {
      status: 500,
      headers: {
        ...getCorsHeaders(request),
        'Content-Type': 'application/json',
      },
    });
  }
}
