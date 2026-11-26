import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { EDGE_CACHE_SECONDS, type EdgeCacheStore, edgeCache } from "./edge-cache";

function memoryStore() {
  const entries = new Map<string, Response>();
  const store: EdgeCacheStore & { entries: Map<string, Response> } = {
    entries,
    async match(request) {
      return entries.get(request.url)?.clone();
    },
    async put(request, response) {
      entries.set(request.url, response);
    },
  };
  return store;
}

function app(store?: EdgeCacheStore) {
  let calls = 0;
  const routes = new Hono()
    .use(edgeCache(store ? { store: () => store } : {}))
    .get("/count", (c) => {
      calls += 1;
      return c.json({ calls }, 200);
    })
    .get("/missing", (c) => c.json({ message: "ไม่พบ" }, 404));
  return { routes, calls: () => calls };
}

describe("edgeCache", () => {
  test("without caches (Bun, tests) it only sets Cache-Control", async () => {
    expect((globalThis as { caches?: unknown }).caches).toBeUndefined();
    const { routes, calls } = app();
    const res = await routes.request("/count");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${EDGE_CACHE_SECONDS}`);
    await routes.request("/count");
    expect(calls()).toBe(2);
  });

  test("a second GET of the same URL is served from the cache", async () => {
    const store = memoryStore();
    const { routes, calls } = app(store);
    const first = await routes.request("http://api.test/count?day=1");
    const second = await routes.request("http://api.test/count?day=1");
    expect(await first.json()).toEqual({ calls: 1 });
    expect(await second.json()).toEqual({ calls: 1 });
    expect(second.headers.get("cache-control")).toContain("max-age=5");
    expect(calls()).toBe(1);

    // Another query string is another entry.
    expect(await (await routes.request("http://api.test/count?day=2")).json()).toEqual({
      calls: 2,
    });
  });

  test("errors and other methods are not cached", async () => {
    const store = memoryStore();
    const { routes } = app(store);
    const missing = await routes.request("http://api.test/missing");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBeNull();
    await routes.request("http://api.test/count", { method: "POST" });
    expect(store.entries.size).toBe(0);
  });
});
