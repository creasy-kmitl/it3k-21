// Tokens for the Discord bots (apps/discord/*), issued and revoked by admins
// on the staff dashboard. The plain token is returned once, by POST; the
// table keeps only its SHA-256 (middleware/bot-token.ts checks it).
import { BOT_TOKEN_SHOWN, botTokenInput } from "@it3k/db/bot-token-rules";
import { user } from "@it3k/db/schema/auth";
import { botToken } from "@it3k/db/schema/bot-token";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { hashBotToken, newBotToken } from "../../middleware/bot-token";
import {
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { limitJsonBody } from "../../middleware/json-body-limit";
import { validate } from "../../middleware/validation";
import { botTokenManagerIsAsRead, canManageBotTokens } from "../../policies/bot-tokens";

const idParam = z.strictObject({ id: z.string().min(1) });

const STALE = "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่";
const NOT_FOUND = "ไม่พบ token นี้ หรือถูกเพิกถอนไปแล้ว";

const managersOnly = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!canManageBotTokens(c.var.user)) {
    return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
  }
  await next();
});

/** What the list shows of a token: never its hash. */
const listed = {
  id: botToken.id,
  name: botToken.name,
  prefix: botToken.prefix,
  createdAt: botToken.createdAt,
  lastUsedAt: botToken.lastUsedAt,
  revokedAt: botToken.revokedAt,
};

export const createBotTokenRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(managersOnly)
    .use(limitJsonBody)

    // Newest first; revoked tokens stay listed as a record of what was issued.
    .get("/", async (c) => {
      const rows = await c.var.db
        .select({ ...listed, createdByName: user.name })
        .from(botToken)
        .leftJoin(user, eq(user.id, botToken.createdBy))
        .orderBy(desc(botToken.createdAt));
      return c.json({ items: rows }, 200);
    })

    .post("/", validate("json", botTokenInput), async (c) => {
      const db = c.var.db;
      const token = newBotToken();
      try {
        const [, [created]] = await db.batch([
          abortUnless(db, c.var.user.id, botTokenManagerIsAsRead(c.var.user)),
          db
            .insert(botToken)
            .values({
              name: c.req.valid("json").name,
              prefix: token.slice(0, BOT_TOKEN_SHOWN),
              tokenHash: await hashBotToken(token),
              createdBy: c.var.user.id,
            })
            .returning(listed),
        ]);
        if (!created) throw new Error("Insert returned no row");
        c.var.log?.audit({
          action: "admin.bot_token.issued",
          actor: { type: "user", id: c.var.user.id },
          target: { type: "bot_token", id: created.id, name: created.name },
          outcome: "success",
        });
        // The only time the plain token leaves the server.
        return c.json({ ...created, createdByName: c.var.user.name, token }, 201);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        throw error;
      }
    })

    // Revokes at once: the next bot request with this token gets 401.
    .delete("/:id", validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, botTokenManagerIsAsRead(c.var.user)),
          db
            .update(botToken)
            .set({ revokedAt: new Date() })
            .where(and(eq(botToken.id, id), isNull(botToken.revokedAt)))
            .returning(listed),
        ]);
        if (!rows[0]) return c.json({ message: NOT_FOUND }, 404);
        c.var.log?.audit({
          action: "admin.bot_token.revoked",
          actor: { type: "user", id: c.var.user.id },
          target: { type: "bot_token", id, name: rows[0].name },
          outcome: "success",
        });
        return c.json(rows[0], 200);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        throw error;
      }
    });

export type BotTokenRoutes = ReturnType<typeof createBotTokenRoutes>;
