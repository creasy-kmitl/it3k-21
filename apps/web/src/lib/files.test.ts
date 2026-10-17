import { expect, test } from "bun:test";
import { Hono } from "hono";
import { uploadedFile } from "@it3k/db/schema/profile";
import { MAX_PENDING_UPLOADS } from "@it3k/db/profile";
import { createTestContext } from "../../../server/src/testing";
import { createFileRoutes } from "../../../server/src/routes/files";
import type { FileStore } from "../../../server/src/routes/files/storage";
import { createFilesApi } from "./files";

async function setup() {
  const t = createTestContext();
  await t.seedUser("guest", { role: "guest" });
  const store: FileStore = {
    createUpload: async () => crypto.randomUUID(),
    abortUpload: async () => {},
    upload: async (_key, body) => {
      await new Response(body).arrayBuffer();
    },
    delete: async () => {},
    download: async () => null,
  };
  const app = new Hono().route(
    "/api/files",
    createFileRoutes({ ...t.deps, getStore: () => store }),
  );
  const request = (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    req.headers.set("x-test-user", "guest");
    return req;
  };
  return { t, app, request };
}
const file = () =>
  new File([new Uint8Array([1])], "lost.bin", { type: "application/octet-stream" });
const options = () => ({ signal: new AbortController().signal, onProgress: () => {} });

test("lost reservation responses are cancelled using the client-known recovery token", async () => {
  const { t, app, request } = await setup();
  const ids: string[] = [];
  const tokens: string[] = [];
  const api = createFilesApi(
    "http://localhost",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = request(input, init);
      if (req.method === "POST")
        tokens.push(((await req.clone().json()) as { requestId: string }).requestId);
      const res = await app.request(req);
      if (req.method === "POST") {
        expect(res.status).toBe(201);
        ids.push(((await res.json()) as { id: string }).id);
        expect(ids.at(-1)).not.toBe(tokens.at(-1));
        throw new TypeError("Reservation response lost");
      }
      expect(req.method).toBe("DELETE");
      expect(req.url).toEndWith(`/uploads/${tokens.at(-1) ?? "missing token"}`);
      expect(res.status).toBe(200);
      return res;
    },
  );
  for (let i = 0; i < MAX_PENDING_UPLOADS + 1; i++) {
    await expect(api.upload(file(), options())).rejects.toThrow("Reservation response lost");
  }
  expect(ids).toHaveLength(MAX_PENDING_UPLOADS + 1);
  expect(await t.db.select().from(uploadedFile)).toEqual([]);
});

test("offline cancellation leaves an owned reservation that can be listed and cancelled later", async () => {
  const { t, app, request } = await setup();
  let offline = true;
  const api = createFilesApi(
    "http://localhost",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = request(input, init);
      if (req.method === "DELETE" && offline) throw new TypeError("Offline");
      const res = await app.request(req);
      if (req.method === "POST") {
        await res.text();
        throw new TypeError("Reservation response lost");
      }
      return res;
    },
  );
  await expect(api.upload(file(), options())).rejects.toThrow("Reservation response lost");
  const page = await api.list();
  expect(page.items).toEqual([]);
  expect(page.uploads).toMatchObject([{ name: "lost.bin", state: "pending" }]);
  offline = false;
  await api.remove(page.uploads[0]?.id ?? "missing ID");
  expect(await t.db.select().from(uploadedFile)).toEqual([]);
});

test("a reservation that commits after early cancellation remains recoverable", async () => {
  const { app, request } = await setup();
  const commit = Promise.withResolvers<void>();
  let reserving: Promise<Response> | undefined;
  const api = createFilesApi(
    "http://localhost",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = request(input, init);
      if (req.method === "POST") {
        reserving = commit.promise.then(() => app.request(req));
        throw new TypeError("Reservation response lost");
      }
      return app.request(req);
    },
  );
  await expect(api.upload(file(), options())).rejects.toThrow("Reservation response lost");
  commit.resolve();
  expect((await reserving)?.status).toBe(201);
  const page = await api.list();
  expect(page.uploads).toHaveLength(1);
  await api.remove(page.uploads[0]?.id ?? "missing ID");
  expect((await api.list()).uploads).toEqual([]);
});

test("an already cancelled upload does not allocate a reservation", async () => {
  let calls = 0;
  const api = createFilesApi("http://localhost", async () => {
    calls++;
    throw new Error("Unexpected request");
  });
  const controller = new AbortController();
  controller.abort();
  await expect(
    api.upload(file(), { signal: controller.signal, onProgress: () => {} }),
  ).rejects.toHaveProperty("name", "AbortError");
  expect(calls).toBe(0);
});
test("successful uploads use the server-issued ID for content and the library", async () => {
  const { app, request } = await setup();
  const api = createFilesApi("http://localhost", (input: RequestInfo | URL, init?: RequestInit) =>
    app.request(request(input, init)),
  );
  const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  class TestXHR {
    private url = "";
    private method = "";
    private headers = new Headers();
    withCredentials = false;
    status = 0;
    responseText = "";
    upload = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onloadend: (() => void) | null = null;
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }
    abort() {
      this.onabort?.();
      this.onloadend?.();
    }
    send(body: File) {
      void (async () => {
        try {
          expect(this.withCredentials).toBe(true);
          const res = await app.request(
            request(this.url, {
              method: this.method,
              headers: this.headers,
              body: await body.arrayBuffer(),
            }),
          );
          this.status = res.status;
          this.responseText = await res.text();
          this.onload?.();
        } catch {
          this.onerror?.();
        } finally {
          this.onloadend?.();
        }
      })();
    }
  }
  try {
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: TestXHR });
    const { id } = await api.upload(file(), options());
    const page = await api.list();
    expect(page.items).toMatchObject([{ id, name: "lost.bin", size: 1 }]);
    expect(page.uploads).toEqual([]);
  } finally {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
    else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  }
});
