import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const GOLD_BRIEF_PROMPT = `You are a professional gold market analyst. Provide a concise market brief (3-5 sentences) covering:

1. Current gold price context and recent movement
2. Key factors affecting gold: Fed rate expectations, inflation data, USD strength, geopolitical tensions
3. Short-term outlook (next 7 days): clearly state BULLISH, BEARISH, or NEUTRAL with reasoning

Be direct and actionable. Focus only on factors relevant to gold traders. No disclaimers.`;

/**
 * GET /api/gold-brief
 * Generates an AI-powered gold market brief using Groq Llama.
 * Requires GROQ_API_KEY environment variable.
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

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return new Response(JSON.stringify({ 
      error: 'GROQ_API_KEY not configured',
      brief: null,
      timestamp: null,
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // Fetch current gold price context from Yahoo Finance
    let priceContext = '';
    try {
      const priceRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=5d');
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        const result = priceData?.chart?.result?.[0];
        if (result?.meta) {
          const currentPrice = result.meta.regularMarketPrice;
          const prevClose = result.meta.previousClose;
          const change = ((currentPrice - prevClose) / prevClose * 100).toFixed(2);
          const high52w = result.meta.fiftyTwoWeekHigh;
          const low52w = result.meta.fiftyTwoWeekLow;
          priceContext = `Current gold price: $${currentPrice.toFixed(2)} (${change >= 0 ? '+' : ''}${change}% today). 52-week range: $${low52w.toFixed(2)} - $${high52w.toFixed(2)}.`;
        }
      }
    } catch (e) {
      console.warn('[gold-brief] Failed to fetch price context:', e.message);
    }

    // Generate brief using Groq Llama
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: GOLD_BRIEF_PROMPT },
          { role: 'user', content: `${priceContext}\n\nGenerate a gold market brief for ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.` },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('[gold-brief] Groq API error:', groqRes.status, errText);
      
      // Handle rate limits
      if (groqRes.status === 429) {
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again in a few minutes.',
          brief: null,
          timestamp: null,
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ 
        error: 'Failed to generate brief',
        brief: null,
        timestamp: null,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const groqData = await groqRes.json();
    const brief = groqData.choices?.[0]?.message?.content?.trim() || '';

    if (!brief) {
      return new Response(JSON.stringify({ 
        error: 'Empty response from AI',
        brief: null,
        timestamp: null,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Detect sentiment from brief
    let sentiment = 'neutral';
    const lowerBrief = brief.toLowerCase();
    if (lowerBrief.includes('bullish') || lowerBrief.includes('upward') || lowerBrief.includes('rally')) {
      sentiment = 'bullish';
    } else if (lowerBrief.includes('bearish') || lowerBrief.includes('downward') || lowerBrief.includes('decline')) {
      sentiment = 'bearish';
    }

    return new Response(JSON.stringify({
      brief,
      sentiment,
      timestamp: new Date().toISOString(),
      model: 'llama-3.1-8b-instant',
      error: null,
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, max-age=60', // Cache for 5 min on CDN, 1 min on client
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error('[gold-brief] Error:', err);
    return new Response(JSON.stringify({ 
      error: err.message || 'Internal error',
      brief: null,
      timestamp: null,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
