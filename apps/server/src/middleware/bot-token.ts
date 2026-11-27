import { createMiddleware } from "hono/factory";

/**
 * Lets the Discord bot (apps/discord/*) call `/api/bot/*` with a shared
 * secret instead of a Better Auth session. The bot has no account and no
 * cookie; it sends `Authorization: Bearer <BOT_API_TOKEN>`.
 *
 * An empty token means the stage has no bot (PR previews by default), so the
 * routes answer 404 as if they did not exist rather than accept any token.
 */
export const requireBotToken = (getToken: () => string) =>
  createMiddleware(async (c, next) => {
    const expected = getToken();
    if (!expected) return c.json({ message: "ไม่พบ" }, 404);

    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!given || !(await sameSecret(given, expected))) {
      return c.json({ message: "token ของบอทไม่ถูกต้อง" }, 401);
    }
    await next();
  });

/**
 * Compares in constant time. Hashing first gives both sides the same length,
 * so neither the length nor the first differing byte leaks through timing.
 */
async function sameSecret(a: string, b: string) {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const left = new Uint8Array(x);
  const right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
