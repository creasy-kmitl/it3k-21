// In-app notifications: who to tell about a change, and the inbox that shows
// them. Rows are written in the same batch as the change they describe.
import type { Database } from "@it3k/db";
import {
  LIVE_CHECKLIST,
  type NotificationKind,
  calendarChecklistItem,
  calendarDependency,
  calendarItem,
  calendarNotification,
  needsLiveChecklist,
} from "@it3k/db/schema/calendar";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { CurrentUser, CurrentUserEnv } from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { id, ms } from "./shared";

const INBOX_LIMIT = 50;
/** Each change tells at most this many people, keeping inserts small. */
const MAX_RECIPIENTS = 12;
/** How far ahead the inbox warns about live blocks and releases that are not ready. */
const ATTENTION_AHEAD_MS = 24 * 60 * 60 * 1000;

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
  const people = [...new Set(recipients)]
    .filter((person): person is string => !!person && person !== actor.id)
    .slice(0, MAX_RECIPIENTS);
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

/** The people an item puts to work: owner, on-call, scoreboard and monitoring. */
export function peopleOn(item: {
  ownerId?: string | null;
  onCallOwnerId?: string | null;
  scoreboardOperatorId?: string | null;
  monitoringOwnerId?: string | null;
}) {
  return [item.ownerId, item.onCallOwnerId, item.scoreboardOperatorId, item.monitoringOwnerId];
}

/** Owners of the items that wait on `itemId`, to tell them it moved. */
export async function downstreamOwners(db: Database, itemId: string) {
  const rows = await db
    .select({ ownerId: calendarItem.ownerId })
    .from(calendarDependency)
    .innerJoin(calendarItem, eq(calendarItem.id, calendarDependency.itemId))
    .where(and(eq(calendarDependency.dependsOnId, itemId), isNull(calendarItem.archivedAt)));
  return rows.map((row) => row.ownerId);
}

type Attention =
  | {
      kind: "readiness";
      itemId: string;
      itemTitle: string;
      startAt: number;
      checklistDone: number;
      hasOnCall: boolean;
    }
  | { kind: "release"; itemId: string; itemTitle: string; startAt: number; missing: string[] };

/**
 * What needs the viewer's attention now, worked out on read rather than
 * stored: their live blocks in the next day that are not ready, and their
 * releases in the next day that are missing a gate.
 */
async function attention(db: Database, actor: CurrentUser, now: number): Promise<Attention[]> {
  const soon = and(
    gt(calendarItem.startAt, new Date(now)),
    lt(calendarItem.startAt, new Date(now + ATTENTION_AHEAD_MS)),
    isNull(calendarItem.archivedAt),
    ne(calendarItem.status, "cancelled"),
  );
  const mine = or(
    eq(calendarItem.ownerId, actor.id),
    eq(calendarItem.onCallOwnerId, actor.id),
    eq(calendarItem.monitoringOwnerId, actor.id),
  );
  const rows = await db
    .select({
      id: calendarItem.id,
      title: calendarItem.title,
      category: calendarItem.category,
      startAt: calendarItem.startAt,
      onCallOwnerId: calendarItem.onCallOwnerId,
      qaResult: calendarItem.qaResult,
      releaseApprovedAt: calendarItem.releaseApprovedAt,
      rollbackPlan: calendarItem.rollbackPlan,
      monitoringOwnerId: calendarItem.monitoringOwnerId,
      status: calendarItem.status,
      // Qualified by hand: Drizzle leaves columns bare in a single-table select,
      // which would compare the checklist's own id here.
      checked: sql<number>`(select count(*) from ${calendarChecklistItem} where ${calendarChecklistItem.itemId} = ${calendarItem}."id" and ${calendarChecklistItem.checked} = 1)`,
    })
    .from(calendarItem)
    .where(and(soon, mine))
    .orderBy(calendarItem.startAt)
    .limit(20);
  return rows.flatMap((row): Attention[] => {
    if (needsLiveChecklist(row)) {
      const missing = LIVE_CHECKLIST.length - Number(row.checked) + (row.onCallOwnerId ? 0 : 1);
      if (missing === 0) return [];
      return [
        {
          kind: "readiness",
          itemId: row.id,
          itemTitle: row.title,
          startAt: row.startAt.getTime(),
          checklistDone: Number(row.checked),
          hasOnCall: row.onCallOwnerId !== null,
        },
      ];
    }
    if (row.category === "release" && row.status !== "released") {
      const missing = [
        row.qaResult !== "passed" && "qa",
        !row.releaseApprovedAt && "approval",
        !row.rollbackPlan?.trim() && "rollbackPlan",
        !row.monitoringOwnerId && "monitoringOwner",
      ].filter((key): key is string => !!key);
      if (missing.length === 0) return [];
      return [
        {
          kind: "release",
          itemId: row.id,
          itemTitle: row.title,
          startAt: row.startAt.getTime(),
          missing,
        },
      ];
    }
    return [];
  });
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
          attention: await attention(db, actor, Date.now()),
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
