/**
 * Vercel edge function for sebuf RPC routes.
 *
 * Matches /api/{domain}/v1/{rpc} via Vercel dynamic segment routing.
 * CORS headers are applied to every response (200, 204, 403, 404).
 * 
 * Gold Trader variant: Only finance-related services are enabled.
 */

export const config = { runtime: 'edge' };

import { createRouter } from '../../../server/router';
import { getCorsHeaders, isDisallowedOrigin } from '../../../server/cors';
// @ts-expect-error — JS module, no declaration file
import { validateApiKey } from '../../_api-key.js';
import { mapErrorToResponse } from '../../../server/error-mapper';
// Finance-related services only
import { createEconomicServiceRoutes } from '../../../src/generated/server/worldmonitor/economic/v1/service_server';
import { economicHandler } from '../../../server/worldmonitor/economic/v1/handler';
import { createMarketServiceRoutes } from '../../../src/generated/server/worldmonitor/market/v1/service_server';
import { marketHandler } from '../../../server/worldmonitor/market/v1/handler';
import { createNewsServiceRoutes } from '../../../src/generated/server/worldmonitor/news/v1/service_server';
import { newsHandler } from '../../../server/worldmonitor/news/v1/handler';
import { createIntelligenceServiceRoutes } from '../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { intelligenceHandler } from '../../../server/worldmonitor/intelligence/v1/handler';
import { createPredictionServiceRoutes } from '../../../src/generated/server/worldmonitor/prediction/v1/service_server';
import { predictionHandler } from '../../../server/worldmonitor/prediction/v1/handler';
import { createGivingServiceRoutes } from '../../../src/generated/server/worldmonitor/giving/v1/service_server';
import { givingHandler } from '../../../server/worldmonitor/giving/v1/handler';

import type { ServerOptions } from '../../../src/generated/server/worldmonitor/economic/v1/service_server';

const serverOptions: ServerOptions = { onError: mapErrorToResponse };

// Gold Trader: Only finance-related routes
const allRoutes = [
  ...createEconomicServiceRoutes(economicHandler, serverOptions),
  ...createMarketServiceRoutes(marketHandler, serverOptions),
  ...createNewsServiceRoutes(newsHandler, serverOptions),
  ...createIntelligenceServiceRoutes(intelligenceHandler, serverOptions),
  ...createPredictionServiceRoutes(predictionHandler, serverOptions),
  ...createGivingServiceRoutes(givingHandler, serverOptions),
];

const router = createRouter(allRoutes);

export default async function handler(request: Request): Promise<Response> {
  // Origin check first — skip CORS headers for disallowed origins (M-2 fix)
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let corsHeaders: Record<string, string>;
  try {
    corsHeaders = getCorsHeaders(request);
  } catch {
    corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  }

  // OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // API key validation (origin-aware)
  const keyCheck = validateApiKey(request);
  if (keyCheck.required && !keyCheck.valid) {
    return new Response(JSON.stringify({ error: keyCheck.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Route matching
  const matchedHandler = router.match(request);
  if (!matchedHandler) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Execute handler with top-level error boundary (H-1 fix)
  let response: Response;
  try {
    response = await matchedHandler(request);
  } catch (err) {
    console.error('[gateway] Unhandled handler error:', err);
    response = new Response(JSON.stringify({ message: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Merge CORS headers into response
  const mergedHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    mergedHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: mergedHeaders,
  });
}
