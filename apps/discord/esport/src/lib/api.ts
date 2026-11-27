// Typed client for apps/server's /api/bot routes. The type comes from the
// server by relative path (as apps/web does), so a changed response shape
// shows up here at type-check time.
import { type InferResponseType, hc } from "hono/client";

import type { BotRoutes } from "../../../../server/src/routes/bot";
import type { Endpoint } from "./mode";

export type ApiClient = ReturnType<typeof hc<BotRoutes>>;
/** What a Discord member is in it3k: linked or not, staff, approved esports registrations. */
export type MemberInfo = InferResponseType<ApiClient["members"][":discordUserId"]["$get"], 200>;

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
  if (!endpoint.token)
    return { ok: false, reason: "ยังไม่ได้ใส่ token ของ mode นี้ (BOT_API_TOKEN_*)", ms: 0 };
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
        ? "server ไม่รับ token ของบอท (ผิด หรือถูกเพิกถอน: ออกใหม่ที่ /staff/bot-tokens ของ stage นั้น)"
        : res.status === 404
          ? "stage นี้ยังไม่มี /api/bot (ยังไม่ได้ deploy)"
          : `server ตอบ ${res.status}`;
    return { ok: false, reason, ms: elapsed() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `ติดต่อ server ไม่ได้: ${reason}`, ms: elapsed() };
  }
}

/** Looks up a Discord member in it3k; throws with a Thai message when the API fails. */
export async function fetchMember(
  endpoint: Endpoint,
  discordUserId: string,
  fetchImpl?: typeof fetch,
): Promise<MemberInfo> {
  if (!endpoint.token) throw new Error("ยังไม่ได้ใส่ token ของ mode นี้ (BOT_API_TOKEN_*)");
  const res = await createApiClient(endpoint, fetchImpl).members[":discordUserId"].$get(
    { param: { discordUserId } },
    { init: { signal: AbortSignal.timeout(5_000) } },
  );
  if (res.status !== 200) throw new Error(`server ตอบ ${res.status}`);
  return res.json();
}
