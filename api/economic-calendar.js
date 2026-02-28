import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

/**
 * GET /api/economic-calendar
 * Fetches high-impact economic events from Finnhub economic calendar.
 * Filters for USD-related events only.
 * 
 * Query params:
 *   - days: number of days to fetch (default: 7, max: 14)
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

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'FINNHUB_API_KEY not configured', events: [] }), {
      status: 200, // Return empty data, not error, for graceful degradation
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const daysParam = parseInt(url.searchParams.get('days') || '7', 10);
  const days = Math.min(Math.max(daysParam, 1), 14); // Clamp to 1-14 days

  // Calculate date range
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 2); // Include 2 days in the past for recent releases
  const toDate = new Date(today);
  toDate.setDate(toDate.getDate() + days);

  const formatDate = (d) => d.toISOString().split('T')[0];

  const finnhubUrl = `https://finnhub.io/api/v1/calendar/economic?from=${formatDate(fromDate)}&to=${formatDate(toDate)}&token=${apiKey}`;

  try {
    const response = await fetch(finnhubUrl, {
      headers: { 'User-Agent': 'GoldTrader/1.0' },
    });

    if (!response.ok) {
      console.error('[economic-calendar] Finnhub error:', response.status);
      return new Response(JSON.stringify({ error: 'Failed to fetch economic calendar', events: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const data = await response.json();

    // Filter for USD/US events and high-impact only
    const events = (data.economicCalendar || [])
      .filter(event => {
        // Only USD events
        if (event.country !== 'US') return false;
        // Filter for high impact (Finnhub uses 1-3, 3 = high)
        if (event.impact < 2) return false;
        return true;
      })
      .map(event => ({
        id: `${event.event}-${event.time}`,
        name: event.event,
        time: event.time, // ISO timestamp
        country: event.country,
        currency: 'USD',
        impact: event.impact === 3 ? 'high' : 'medium',
        actual: event.actual !== null ? String(event.actual) : null,
        estimate: event.estimate !== null ? String(event.estimate) : null,
        prev: event.prev !== null ? String(event.prev) : null,
        unit: event.unit || '',
      }))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300', // Cache 5 min
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error('[economic-calendar] Error:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch economic calendar', events: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
