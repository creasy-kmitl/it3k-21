import { BOT_TOKEN_PREFIX } from "@it3k/db/bot-token-rules";
import { botToken } from "@it3k/db/schema/bot-token";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

import type { RouteDeps } from "./current-user";

/** lastUsedAt is a hint, not an audit log: write it at most this often per token. */
const LAST_USED_EVERY_MS = 5 * 60 * 1000;
const UNAUTHORIZED = { message: "token ของบอทไม่ถูกต้องหรือถูกเพิกถอนแล้ว" };

/**
 * Lets the Discord bots (apps/discord/*) call `/api/bot/*` with a token an
 * admin issued on the staff dashboard instead of a Better Auth session. The
 * bot has no account and no cookie; it sends `Authorization: Bearer <token>`.
 *
 * Only the token's SHA-256 is stored, so the lookup is by hash: a timing
 * difference could at most tell which hashes exist, which says nothing about
 * any token.
 */
export const requireBotToken = (deps: Pick<RouteDeps, "getDb">) =>
  createMiddleware(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!given.startsWith(BOT_TOKEN_PREFIX)) return c.json(UNAUTHORIZED, 401);

    const db = deps.getDb();
    const tokenHash = await hashBotToken(given);
    const [row] = await db
      .select({ id: botToken.id, lastUsedAt: botToken.lastUsedAt })
      .from(botToken)
      .where(and(eq(botToken.tokenHash, tokenHash), isNull(botToken.revokedAt)));
    if (!row) return c.json(UNAUTHORIZED, 401);

    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
      const stale = new Date(now - LAST_USED_EVERY_MS);
      await db
        .update(botToken)
        .set({ lastUsedAt: new Date(now) })
        .where(
          and(
            eq(botToken.id, row.id),
            or(isNull(botToken.lastUsedAt), lt(botToken.lastUsedAt, stale)),
          ),
        );
    }
    await next();
  });

/** A new token: the prefix, then 32 random bytes as base64url (256 bits). */
export function newBotToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return BOT_TOKEN_PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hex SHA-256: what the table keeps in place of the token. */
export async function hashBotToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
