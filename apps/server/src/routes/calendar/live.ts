// Live readiness: who is on call, the live checklist, and clashes over the
// same people, rooms and streams.
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  type ConflictKind,
  LIVE_CHECKLIST,
  type LiveChecklistKey,
  calendarChecklistItem,
  calendarItem,
  needsLiveChecklist,
} from "@it3k/db/schema/calendar";
import { type SQL, and, eq, exists, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { type CurrentUser, type CurrentUserEnv, abortUnless } from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { canEditCalendar, stillCalendarEditor, stillMember } from "../../policies/calendar";
import { conflictResponse, logChange, ms, optionalText } from "./shared";

/** The slot an item holds, and who and what it holds it with. */
export type Slot = {
  excludeId?: string;
  startAt: number;
  endAt: number;
  ownerId: string | null;
  onCallOwnerId: string | null;
  scoreboardOperatorId: string | null;
  venue: string | null;
  streamPlatform: string | null;
};

export type Conflict = {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  kinds: ConflictKind[];
  /** Names of the people booked in both places. */
  people: string[];
};

const normal = (value: string | null) => value?.trim().toLowerCase() || null;

/**
 * Other live-slot items overlapping `slot` that share a person (owner,
 * on-call or scoreboard operator), the venue or the stream channel.
 * Cancelled, archived and delivery items never clash.
 */
export async function findConflicts(db: Database, slot: Slot): Promise<Conflict[]> {
  const people = [slot.ownerId, slot.onCallOwnerId, slot.scoreboardOperatorId].filter(
    (person): person is string => !!person,
  );
  const venue = normal(slot.venue);
  const stream = normal(slot.streamPlatform);
  const shares: SQL[] = [];
  if (people.length > 0) {
    shares.push(
      inArray(calendarItem.ownerId, people),
      inArray(calendarItem.onCallOwnerId, people),
      inArray(calendarItem.scoreboardOperatorId, people),
    );
  }
  if (venue) shares.push(sql`lower(trim(${calendarItem.venue})) = ${venue}`);
  if (stream) shares.push(sql`lower(trim(${calendarItem.streamPlatform})) = ${stream}`);
  if (shares.length === 0) return [];

  const rows = await db
    .select({
      id: calendarItem.id,
      title: calendarItem.title,
      startAt: calendarItem.startAt,
      endAt: calendarItem.endAt,
      ownerId: calendarItem.ownerId,
      onCallOwnerId: calendarItem.onCallOwnerId,
      scoreboardOperatorId: calendarItem.scoreboardOperatorId,
      venue: calendarItem.venue,
      streamPlatform: calendarItem.streamPlatform,
    })
    .from(calendarItem)
    .where(
      and(
        lt(calendarItem.startAt, new Date(slot.endAt)),
        gt(calendarItem.endAt, new Date(slot.startAt)),
        isNull(calendarItem.archivedAt),
        ne(calendarItem.status, "cancelled"),
        ne(calendarItem.mode, "delivery"),
        slot.excludeId ? ne(calendarItem.id, slot.excludeId) : undefined,
        or(...shares),
      ),
    )
    .orderBy(calendarItem.startAt)
    .limit(20);
  if (rows.length === 0) return [];

  const names = new Map(
    (
      await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, people))
    ).map((row) => [row.id, row.name]),
  );
  return rows.map((row) => {
    const shared = people.filter((person) =>
      [row.ownerId, row.onCallOwnerId, row.scoreboardOperatorId].includes(person),
    );
    const kinds: ConflictKind[] = [];
    if (shared.length > 0) kinds.push("person");
    if (venue && normal(row.venue) === venue) kinds.push("venue");
    if (stream && normal(row.streamPlatform) === stream) kinds.push("stream");
    return {
      id: row.id,
      title: row.title,
      startAt: row.startAt.getTime(),
      endAt: row.endAt.getTime(),
      kinds,
      people: [...new Set(shared)].map((person) => names.get(person) ?? ""),
    };
  });
}

export const CONFLICT_MESSAGE =
  "This clashes with other items; accept with a mitigation to save anyway";

/** SQL: every checklist entry of the item is checked. */
export function checklistComplete(itemId: string): SQL {
  return sql`(select count(*) from ${calendarChecklistItem} where ${calendarChecklistItem.itemId} = ${itemId} and ${calendarChecklistItem.checked} = 1) = ${LIVE_CHECKLIST.length}`;
}

/** What a live item still lacks before it may be marked ready or live. */
export async function readinessProblems(
  db: Database,
  itemId: string | null,
  onCallOwnerId: string | null,
): Promise<string[]> {
  const missing: string[] = [];
  if (!onCallOwnerId) missing.push("onCall");
  const checked = itemId
    ? await db
        .select({ key: calendarChecklistItem.key })
        .from(calendarChecklistItem)
        .where(
          and(eq(calendarChecklistItem.itemId, itemId), eq(calendarChecklistItem.checked, true)),
        )
    : [];
  const done = new Set(checked.map((row) => row.key));
  for (const key of LIVE_CHECKLIST) if (!done.has(key)) missing.push(key);
  return missing;
}

/** Only the confirmed-times entry depends on when the item is. */
export function uncheckTimes(db: Database, itemId: string) {
  return db
    .update(calendarChecklistItem)
    .set({ checked: false, checkedAt: null, checkedById: null })
    .where(and(eq(calendarChecklistItem.itemId, itemId), eq(calendarChecklistItem.key, "times")));
}

/** Editors and the item's on-call owner tick the checklist. */
export function canCheck(actor: CurrentUser, item: { onCallOwnerId: string | null }) {
  return canEditCalendar(actor) || (!!item.onCallOwnerId && item.onCallOwnerId === actor.id);
}

export async function loadChecklist(
  db: Database,
  item: { id: string; category: Parameters<typeof needsLiveChecklist>[0]["category"] },
) {
  if (!needsLiveChecklist(item)) return null;
  const rows = await db
    .select({ entry: calendarChecklistItem, checkedByName: user.name })
    .from(calendarChecklistItem)
    .leftJoin(user, eq(user.id, calendarChecklistItem.checkedById))
    .where(eq(calendarChecklistItem.itemId, item.id));
  const byKey = new Map(rows.map((row) => [row.entry.key, row]));
  return LIVE_CHECKLIST.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      checked: row?.entry.checked ?? false,
      note: row?.entry.note ?? null,
      checkedAt: ms(row?.entry.checkedAt ?? null),
      checkedBy: row?.checkedByName ?? null,
    };
  });
}

const checklistParam = z.strictObject({ id: z.uuid(), key: z.enum(LIVE_CHECKLIST) });
const checklistInput = z.strictObject({ checked: z.boolean(), note: optionalText(500) });

export const createLiveRoutes = () =>
  new Hono<CurrentUserEnv>().put(
    "/items/:id/checklist/:key",
    validate("param", checklistParam),
    validate("json", checklistInput),
    async (c) => {
      const { id: itemId, key } = c.req.valid("param");
      const { checked, note } = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      const [item] = await db
        .select({
          id: calendarItem.id,
          category: calendarItem.category,
          onCallOwnerId: calendarItem.onCallOwnerId,
        })
        .from(calendarItem)
        .where(eq(calendarItem.id, itemId));
      if (!item) return c.json({ message: "Item not found" }, 404);
      if (!needsLiveChecklist(item)) {
        return c.json({ message: "Only matches, broadcasts and technical checks have one" }, 400);
      }
      if (!canCheck(actor, item)) return c.json({ message: "Forbidden" }, 403);
      const [before] = await db
        .select()
        .from(calendarChecklistItem)
        .where(and(eq(calendarChecklistItem.itemId, itemId), eq(calendarChecklistItem.key, key)));
      const now = new Date();
      const values = {
        checked,
        note: note === undefined ? (before?.note ?? null) : note,
        checkedAt: checked ? now : null,
        checkedById: checked ? actor.id : null,
      };
      // Editors keep the right from their department; the on-call owner from the item.
      const guard = canEditCalendar(actor)
        ? stillCalendarEditor()
        : and(
            stillMember(),
            exists(
              db
                .select({ id: calendarItem.id })
                .from(calendarItem)
                .where(and(eq(calendarItem.id, itemId), eq(calendarItem.onCallOwnerId, actor.id))),
            ),
          );
      try {
        await db.batch([
          abortUnless(db, actor.id, guard ?? sql`1`),
          db
            .insert(calendarChecklistItem)
            .values({ itemId, key, ...values })
            .onConflictDoUpdate({
              target: [calendarChecklistItem.itemId, calendarChecklistItem.key],
              set: values,
            }),
          logChange(db, actor, itemId, "checklist", {
            [`checklist.${key satisfies LiveChecklistKey}`]: [before?.checked ?? false, checked],
            ...(values.note !== (before?.note ?? null)
              ? { [`checklistNote.${key}`]: [before?.note ?? null, values.note] }
              : {}),
          }),
        ]);
      } catch (error) {
        const conflict = conflictResponse(error);
        if (conflict) return c.json({ message: conflict.message }, conflict.status);
        throw error;
      }
      return c.json({ ok: true }, 200);
    },
  );
