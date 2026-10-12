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

/**
 * Where the previous page ended: `<createdAt ms>.<rowid>`. The rowid breaks
 * ties between notices written in the same millisecond, in insertion order.
 */
const inboxQuery = z.strictObject({
  cursor: z
    .string()
    .regex(/^\d{1,16}\.\d{1,16}$/)
    .optional(),
});

const readInput = z.union([
  z.strictObject({ ids: z.array(id).min(1).max(INBOX_LIMIT) }),
  z.strictObject({ all: z.literal(true) }),
]);

export const createNotificationRoutes = () =>
  new Hono<CurrentUserEnv>()
    // Newest first, a page at a time, so older notices (unread ones too) stay reachable.
    .get("/notifications", validate("query", inboxQuery), async (c) => {
      const db = c.var.db;
      const actor = c.var.user;
      const { cursor } = c.req.valid("query");
      const rowid = sql<number>`${calendarNotification}.rowid`;
      const filters = [eq(calendarNotification.userId, actor.id)];
      if (cursor) {
        const [at, id] = cursor.split(".").map(Number) as [number, number];
        filters.push(
          sql`(${calendarNotification.createdAt} < ${at} or (${calendarNotification.createdAt} = ${at} and ${rowid} < ${id}))`,
        );
      }
      const found = await db
        .select({ notice: calendarNotification, rowid })
        .from(calendarNotification)
        .where(and(...filters))
        .orderBy(desc(calendarNotification.createdAt), sql`${rowid} desc`)
        .limit(INBOX_LIMIT + 1);
      const page = found.slice(0, INBOX_LIMIT);
      const last = page.at(-1);
      const rows = page.map((row) => row.notice);
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
          /** Pass back as `cursor` for the next, older page; null on the last one. */
          nextCursor:
            found.length > INBOX_LIMIT && last
              ? `${last.notice.createdAt.getTime()}.${last.rowid}`
              : null,
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
