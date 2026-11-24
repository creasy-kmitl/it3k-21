import { createMiddleware } from "hono/factory";

export const MAX_JSON_BODY_SIZE = 64 * 1024;

/** `limitJsonBody` with another bound, for the few routes that take long text. */
export function jsonBodyLimit(maxBytes: number) {
  return createMiddleware(async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) || !c.req.raw.body) return next();
    const tooLarge = () => c.json({ message: `ข้อมูลที่ส่งมีขนาดเกิน ${maxBytes / 1024} KiB` }, 413);
    const length = c.req.header("content-length");
    if (length && /^\d+$/.test(length) && Number(length) > maxBytes) return tooLarge();

    // Count actual bytes too: a small or missing Content-Length is not a bound.
    const reader = c.req.raw.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return tooLarge();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    c.req.raw = new Request(c.req.raw, { method: c.req.method, body: bytes });
    return next();
  });
}

/** Bound small API bodies before JSON parsing, including chunked requests. */
export const limitJsonBody = jsonBodyLimit(MAX_JSON_BODY_SIZE);
