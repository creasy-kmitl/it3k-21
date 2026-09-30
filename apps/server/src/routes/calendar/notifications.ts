// In-app notifications: who to tell about a change, and the inbox that shows
// them. Rows are written in the same batch as the change they describe.
import type { Database } from "@it3k/db";
import { type NotificationKind, calendarNotification } from "@it3k/db/schema/calendar";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { CurrentUser, CurrentUserEnv } from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { id, ms } from "./shared";

const INBOX_LIMIT = 50;

export type Notice = {
  kind: NotificationKind;
  itemId: string;
  itemTitle: string;
  data?: Record<string, unknown>;
};

/**
 * The insert for `notice` to everyone in `recipients` except the actor, each
 * once. Returns no statement when nobody is left to tell.
 */
export function notify(
  db: Database,
  actor: CurrentUser,
  recipients: (string | null | undefined)[],
  notice: Notice,
) {
  const people = [...new Set(recipients)].filter(
    (person): person is string => !!person && person !== actor.id,
  );
  if (people.length === 0) return [];
  return [
    db.insert(calendarNotification).values(
      people.map((userId) => ({
        userId,
        itemId: notice.itemId,
        kind: notice.kind,
        itemTitle: notice.itemTitle,
        data: notice.data ?? {},
        actorUserId: actor.id,
      })),
    ),
  ];
}

const readInput = z.union([
  z.strictObject({ ids: z.array(id).min(1).max(INBOX_LIMIT) }),
  z.strictObject({ all: z.literal(true) }),
]);

export const createNotificationRoutes = () =>
  new Hono<CurrentUserEnv>()
    .get("/notifications", async (c) => {
      const db = c.var.db;
      const actor = c.var.user;
      const rows = await db
        .select()
        .from(calendarNotification)
        .where(eq(calendarNotification.userId, actor.id))
        .orderBy(desc(calendarNotification.createdAt), sql`${calendarNotification}.rowid desc`)
        .limit(INBOX_LIMIT);
      const [unread] = await db
        .select({ count: sql<number>`count(*)` })
        .from(calendarNotification)
        .where(and(eq(calendarNotification.userId, actor.id), isNull(calendarNotification.readAt)));
      return c.json(
        {
          items: rows.map((row) => ({
            id: row.id,
            itemId: row.itemId,
            kind: row.kind,
            itemTitle: row.itemTitle,
            data: row.data,
            createdAt: row.createdAt.getTime(),
            readAt: ms(row.readAt),
          })),
          unread: Number(unread?.count ?? 0),
        },
        200,
      );
    })

    .post("/notifications/read", validate("json", readInput), async (c) => {
      const input = c.req.valid("json");
      const actor = c.var.user;
      await c.var.db
        .update(calendarNotification)
        .set({ readAt: new Date() })
        .where(
          and(
            // Only ever the caller's own notifications.
            eq(calendarNotification.userId, actor.id),
            isNull(calendarNotification.readAt),
            "ids" in input ? inArray(calendarNotification.id, input.ids) : undefined,
          ),
        );
      return c.json({ ok: true }, 200);
    });
