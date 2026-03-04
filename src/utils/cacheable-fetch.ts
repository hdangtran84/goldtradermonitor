/**
 * Caching fetch wrapper for RPC calls.
 * 
 * Transforms POST requests to read-only RPCs into GET requests with the body
 * encoded as a query parameter. This enables CDN caching for these endpoints.
 * 
 * Usage:
 *   const client = new MarketServiceClient('', { fetch: cacheableFetch });
 */

// RPC path prefixes that are safe to convert from POST to GET (idempotent, read-only)
const READ_ONLY_RPC_PREFIXES = ['list-', 'get-'];

function isReadOnlyRpc(pathname: string): boolean {
  const rpcName = pathname.split('/').pop() || '';
  return READ_ONLY_RPC_PREFIXES.some(prefix => rpcName.startsWith(prefix));
}

/**
 * Encodes request body as base64 for use in query parameter.
 * Uses standard btoa which is available in browsers and modern Node.js.
 */
function encodeBody(body: string): string {
  try {
    // Use base64 encoding for safe URL transmission
    return btoa(body);
  } catch {
    // Fallback to URL encoding for non-ASCII
    return encodeURIComponent(body);
  }
}

/**
 * A fetch wrapper that converts POST requests to read-only RPCs into GET requests.
 * This enables CDN caching for idempotent RPC endpoints.
 */
export async function cacheableFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Only transform POST requests to API RPC routes
  if (init?.method !== 'POST' || !init?.body) {
    return globalThis.fetch(input, init);
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const urlObj = new URL(url, globalThis.location?.origin || 'https://localhost');
  
  // Only transform read-only RPCs
  if (!isReadOnlyRpc(urlObj.pathname)) {
    return globalThis.fetch(input, init);
  }

  // Convert body to query param
  const body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  const encodedBody = encodeBody(body);
  
  // Build GET URL with encoded body
  urlObj.searchParams.set('q', encodedBody);
  
  // Create new init without body, with GET method
  const getInit: RequestInit = {
    ...init,
    method: 'GET',
    body: undefined,
  };
  
  // Remove Content-Type header (not needed for GET)
  if (getInit.headers) {
    const headers = new Headers(getInit.headers as HeadersInit);
    headers.delete('Content-Type');
    getInit.headers = headers;
  }

  return globalThis.fetch(urlObj.toString(), getInit);
}

/**
 * Creates a fetch function that uses GET for read-only RPCs.
 * Use this when creating service clients to enable CDN caching.
 */
export function createCacheableFetch(): typeof fetch {
  return cacheableFetch as typeof fetch;
}
