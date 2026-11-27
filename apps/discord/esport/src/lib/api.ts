// Typed client for apps/server's /api/bot routes. The type comes from the
// server by relative path (as apps/web does), so a changed response shape
// shows up here at type-check time.
import { hc } from "hono/client";

import type { BotRoutes } from "../../../../server/src/routes/bot";
import type { Endpoint } from "./mode";

export type ApiClient = ReturnType<typeof hc<BotRoutes>>;

export function createApiClient(endpoint: Endpoint, fetchImpl?: typeof fetch): ApiClient {
  return hc<BotRoutes>(`${endpoint.url.replace(/\/+$/, "")}/api/bot`, {
    headers: endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {},
    fetch: fetchImpl,
  });
}

export type PingResult =
  | { ok: true; stage: string; ms: number }
  | { ok: false; reason: string; ms: number };

/** Checks that `endpoint` is up and accepts its token, with a Thai reason when not. */
export async function ping(endpoint: Endpoint, fetchImpl?: typeof fetch): Promise<PingResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  if (!endpoint.token) return { ok: false, reason: "ยังไม่ได้ตั้ง BOT_API_TOKEN ของ mode นี้", ms: 0 };
  try {
    const res = await createApiClient(endpoint, fetchImpl).ping.$get(undefined, {
      init: { signal: AbortSignal.timeout(5_000) },
    });
    if (res.status === 200) {
      const body = await res.json();
      return { ok: true, stage: body.stage, ms: elapsed() };
    }
    const reason =
      res.status === 401
        ? "server ไม่รับ token ของบอท (BOT_API_TOKEN ไม่ตรงกัน)"
        : res.status === 404
          ? "stage นี้ยังไม่เปิด /api/bot (ไม่ได้ตั้ง BOT_API_TOKEN ฝั่ง server)"
          : `server ตอบ ${res.status}`;
    return { ok: false, reason, ms: elapsed() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `ติดต่อ server ไม่ได้: ${reason}`, ms: elapsed() };
  }
}
