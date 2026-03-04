/**
 * Map-based route matcher for sebuf-generated RouteDescriptor arrays.
 *
 * All sebuf routes are static POST paths (e.g., "POST /api/seismology/v1/list-earthquakes"),
 * so a simple Map lookup keyed by "METHOD /path" is sufficient -- no regex or dynamic segments.
 *
 * GET support: Read-only RPCs (List*, Get*) also accept GET with query params for CDN cacheability.
 */

/** Same shape as the generated RouteDescriptor (defined locally to avoid importing from a specific generated file). */
export interface RouteDescriptor {
  method: string;
  path: string;
  handler: (req: Request) => Promise<Response>;
}

export interface Router {
  match(req: Request): ((req: Request) => Promise<Response>) | null;
}

// RPC names that are read-only and safe to cache via GET
const READ_ONLY_RPC_PREFIXES = ['list-', 'get-'];

function isReadOnlyPath(path: string): boolean {
  const rpcName = path.split('/').pop() || '';
  return READ_ONLY_RPC_PREFIXES.some(prefix => rpcName.startsWith(prefix));
}

/**
 * Wraps a POST handler to also accept GET requests with JSON body in ?q= query param.
 * Enables CDN caching for read-only RPCs.
 */
function wrapForGet(postHandler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const qParam = url.searchParams.get('q');
    
    // Parse JSON from ?q= param and create a fake POST request
    let body: string;
    try {
      // Support both base64-encoded and plain JSON in ?q=
      if (qParam) {
        // Try base64 first, fall back to URL-decoded JSON
        try {
          body = atob(qParam);
        } catch {
          body = decodeURIComponent(qParam);
        }
      } else {
        // No ?q= param, use empty object
        body = '{}';
      }
      // Validate it's valid JSON
      JSON.parse(body);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid q parameter - must be valid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create a POST-like request with the parsed body
    const fakePostRequest = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body,
    });

    return postHandler(fakePostRequest);
  };
}

export function createRouter(allRoutes: RouteDescriptor[]): Router {
  const table = new Map<string, (req: Request) => Promise<Response>>();
  for (const route of allRoutes) {
    const key = `${route.method} ${route.path}`;
    table.set(key, route.handler);
    
    // Also register GET for read-only RPCs to enable CDN caching
    if (route.method === 'POST' && isReadOnlyPath(route.path)) {
      const getKey = `GET ${route.path}`;
      table.set(getKey, wrapForGet(route.handler));
    }
  }

  return {
    match(req: Request) {
      const url = new URL(req.url);
      // Normalize trailing slashes: /api/foo/v1/bar/ -> /api/foo/v1/bar
      const pathname = url.pathname.length > 1 && url.pathname.endsWith('/')
        ? url.pathname.slice(0, -1)
        : url.pathname;
      const key = `${req.method} ${pathname}`;
      return table.get(key) ?? null;
    },
  };
}
