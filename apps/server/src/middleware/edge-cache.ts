// Caches public GET answers at the Cloudflare edge for a few seconds, so a
// crowd watching the live board costs one database read per URL per few
// seconds instead of one per viewer. Keyed by the full URL, query included.
//
// Only for routes that answer the same to everyone: a cached answer is served
// without running the route, so it must never depend on who is asking.
import type { MiddlewareHandler } from "hono";

/** The part of the Workers Cache API this uses. */
export type EdgeCacheStore = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

/** `caches.default` on Workers; undefined under Bun and in tests, which then skip caching. */
function defaultStore(): EdgeCacheStore | undefined {
  const global = globalThis as { caches?: { default?: EdgeCacheStore } };
  return global.caches?.default;
}

export const EDGE_CACHE_SECONDS = 5;

export function edgeCache(
  options: { seconds?: number; store?: () => EdgeCacheStore | undefined } = {},
): MiddlewareHandler {
  const seconds = options.seconds ?? EDGE_CACHE_SECONDS;
  const getStore = options.store ?? defaultStore;
  const cacheControl = `public, max-age=${seconds}`;

  return async (c, next) => {
    if (c.req.method !== "GET") return next();
    const store = getStore();
    const key = new Request(c.req.url, { method: "GET" });

    if (store) {
      const hit = await store.match(key);
      if (hit) return new Response(hit.body, hit);
    }

    await next();
    if (c.res.status !== 200) return;
    c.res.headers.set("Cache-Control", cacheControl);
    if (!store) return;

    const saving = store.put(key, c.res.clone()).catch(() => {
      // A failed save only costs the next viewer a database read.
    });
    try {
      c.executionCtx.waitUntil(saving);
    } catch {
      // No execution context (tests, Bun): wait here instead.
      await saving;
    }
  };
}
