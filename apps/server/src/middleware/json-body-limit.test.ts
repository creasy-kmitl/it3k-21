import { expect, test } from "bun:test";
import { Hono } from "hono";
import { limitJsonBody, MAX_JSON_BODY_SIZE } from "./json-body-limit";

function app(onParse = () => {}) {
  return new Hono().use(limitJsonBody).post("/", async (c) => {
    onParse();
    return c.json(await c.req.json());
  });
}
test("accepts the exact byte limit and rejects larger bodies before parsing", async () => {
  let parses = 0;
  const routes = app(() => parses++);
  const body = `${" ".repeat(MAX_JSON_BODY_SIZE - 2)}{}`;
  expect((await routes.request("/", { method: "POST", body })).status).toBe(200);
  expect((await routes.request("/", { method: "POST", body: `${body} ` })).status).toBe(413);
  expect(parses).toBe(1);
});
test("rejects a large declared size without reading the incoming body", async () => {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        reads++;
      },
    },
    { highWaterMark: 0 },
  );
  const res = await app().request("/", {
    method: "POST",
    headers: { "content-length": String(MAX_JSON_BODY_SIZE + 1) },
    body,
  });
  expect(res.status).toBe(413);
  expect(reads).toBe(0);
});
for (const declaredLength of [undefined, "1"]) {
  test(`bounds streamed bytes with ${declaredLength ? "a false" : "no"} Content-Length`, async () => {
    let cancelled = false;
    let chunks = 0;
    let parses = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(16384).fill(32));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const headers = new Headers();
    if (declaredLength) headers.set("content-length", declaredLength);
    const res = await app(() => parses++).request("/", { method: "POST", headers, body });
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(chunks).toBe(5);
    expect(parses).toBe(0);
  });
}
test("counts UTF-8 bytes instead of string length", async () => {
  const body = JSON.stringify({ text: "ก".repeat(MAX_JSON_BODY_SIZE / 2) });
  expect(body.length).toBeLessThan(MAX_JSON_BODY_SIZE);
  expect((await app().request("/", { method: "POST", body })).status).toBe(413);
});
