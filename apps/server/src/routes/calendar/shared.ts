// Pieces the calendar routes share.
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { type CalendarChangeAction, calendarChange, calendarItem } from "@it3k/db/schema/calendar";
import { and, eq, exists } from "drizzle-orm";
import { z } from "zod";

import { type CurrentUser, constraintError } from "../../middleware/current-user";

const MAX_QUERY_CODE_POINTS = 64;

export const STALE_MESSAGE = "This item changed while you were editing; reload and try again";

export const epochMs = z
  .number()
  .int()
  .min(Date.UTC(2020, 0, 1))
  .max(Date.UTC(2100, 0, 1));

// Seeded department ids are hex and Better Auth user ids are random strings,
// so neither is validated as a UUID; calendar ids are.
export const id = z.string().min(1).max(64);
export const idParam = z.strictObject({ id: z.uuid() });

export const searchText = z
  .string()
  .trim()
  // Count code points, not UTF-16 units, so Thai and emoji are treated alike.
  .refine((q) => [...q].length <= MAX_QUERY_CODE_POINTS, {
    message: `Search is limited to ${MAX_QUERY_CODE_POINTS} characters`,
  });

/** Trimmed optional text where blank means "none". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

export const ms = (date: Date | null) => (date ? date.getTime() : null);

/** Owners and assignees must be staff members or admins. */
export async function ownerProblem(db: Database, ownerId: string): Promise<string | null> {
  const [owner] = await db.select({ role: user.role }).from(user).where(eq(user.id, ownerId));
  if (!owner) return "Owner not found";
  const roles = (owner.role ?? "").split(",").map((role) => role.trim());
  if (!roles.includes("staff") && !roles.includes("admin")) return "The owner must be a member";
  return null;
}

/** Same item, same version: nobody saved in between. For abortUnless. */
export function itemIsAsRead(db: Database, itemId: string, version: number) {
  return exists(
    db
      .select({ id: calendarItem.id })
      .from(calendarItem)
      .where(and(eq(calendarItem.id, itemId), eq(calendarItem.version, version))),
  );
}

/** `{ field: [before, after] }` */
export type Change = Record<string, [unknown, unknown]>;

/** Stored values in the shape the change log and the API use. */
export function comparable(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value === undefined) return null;
  return value;
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A change-log row on `itemId`, for the same batch as the write it records. */
export function logChange(
  db: Database,
  actor: CurrentUser,
  itemId: string,
  action: CalendarChangeAction,
  changes: Change,
  reason: string | null = null,
) {
  return db.insert(calendarChange).values({
    itemId,
    actorUserId: actor.id,
    impersonatedBy: actor.impersonatedBy,
    action,
    changes,
    reason,
  });
}

export function conflictResponse(error: unknown) {
  const kind = constraintError(error);
  if (kind === "stale") return { message: STALE_MESSAGE, status: 409 as const };
  if (kind === "foreign-key") {
    return { message: "Someone or something it refers to no longer exists", status: 409 as const };
  }
  return null;
}
