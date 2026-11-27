import type { Database } from "@it3k/db";
import type { Institution } from "@it3k/db/profile";
import { account, user } from "@it3k/db/schema/auth";
import { userProfile } from "@it3k/db/schema/profile";
import {
  type RegistrationChangeAction,
  athlete,
  sport,
  sportDivision,
  sportRegistration,
  sportRegistrationChange,
} from "@it3k/db/schema/sport";
import { type AnyColumn, type SQL, and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { type CurrentUser, constraintMessage } from "../../middleware/current-user";

export const DISCORD = "discord";

/** Looks up the linked Discord account's username, display name and avatar; null when it cannot. */
export type DiscordProfile = (
  headers: Headers,
  accountRecordId: string,
) => Promise<{ username: string; displayName?: string | null; avatarUrl?: string | null } | null>;

export type DiscordDeps = {
  /** False when no Discord app is configured; esports registration is closed then. */
  discordEnabled: boolean;
  discordProfile: DiscordProfile;
};

export async function linkedDiscord(db: Database, userId: string) {
  const [row] = await db
    .select({ id: account.id, discordUserId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, DISCORD)));
  return row ?? null;
}

/** Registrations joined with what lists and exports show about them. */
export function selectRegistrations(db: Database) {
  return db
    .select({
      registration: sportRegistration,
      division: {
        id: sportDivision.id,
        code: sportDivision.code,
        name: sportDivision.name,
        gender: sportDivision.gender,
        format: sportDivision.format,
        requiresShirtNumber: sportDivision.requiresShirtNumber,
        requiresBadmintonRank: sportDivision.requiresBadmintonRank,
        requiresGameProfile: sportDivision.requiresGameProfile,
      },
      sport: {
        id: sport.id,
        code: sport.code,
        name: sport.name,
        icon: sport.icon,
        thumbnailUrl: sport.thumbnailUrl,
      },
      athlete: { name: user.name, image: user.image, studentId: athlete.studentId },
      profile: userProfile.values,
    })
    .from(sportRegistration)
    .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .innerJoin(user, eq(user.id, sportRegistration.userId))
    .leftJoin(athlete, eq(athlete.userId, sportRegistration.userId))
    .leftJoin(userProfile, eq(userProfile.userId, sportRegistration.userId));
}

export type RegistrationRow = Awaited<
  ReturnType<ReturnType<typeof selectRegistrations>["all"]>
>[number];

/** `{ field: [before, after] }` for the fields that differ. */
export function diff<T extends Record<string, unknown>>(before: Partial<T>, after: Partial<T>) {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    if (after[key] !== undefined && before[key] !== after[key]) {
      changes[key] = [before[key] ?? null, after[key]];
    }
  }
  return changes;
}

export function logChange(
  db: Database,
  actor: CurrentUser,
  registration: { id: string; userId: string },
  action: RegistrationChangeAction,
  changes: Record<string, [unknown, unknown]>,
) {
  return db.insert(sportRegistrationChange).values({
    registrationId: registration.id,
    athleteUserId: registration.userId,
    actorUserId: actor.id,
    impersonatedBy: actor.impersonatedBy,
    action,
    changes,
  });
}

/** The message for a unique index a registration write ran into, if any. */
export function registrationConflict(error: unknown): string | null {
  const message = constraintMessage(error) ?? "";
  if (!message.includes("UNIQUE constraint failed: sport_registration.")) return null;
  if (message.includes("shirt_number")) return "เบอร์เสื้อนี้มีคนในทีมเดียวกันใช้แล้ว";
  if (message.includes("badminton_rank")) return "มือนี้ของสถาบันมีผู้สมัครแล้ว";
  return "สมัครประเภทนี้ไว้แล้ว";
}

export const STALE = "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่";

// The per-institution limit counts approved registrations only: anyone may
// apply, and registration staff choose who fills the places when approving.

export const TEAM_FULL = "สถาบันนี้อนุมัติครบจำนวนของประเภทนี้แล้ว";
export const MOVE_FULL = "ย้ายสถาบันไม่ได้ สถาบันใหม่อนุมัติครบจำนวนในประเภทที่นักกีฬาคนนี้ได้รับอนุมัติแล้ว";

/**
 * SQL: approving `userId` in `divisionId` for `institution` stays within the
 * division's limit, counting everyone else already approved there.
 */
export function approvedRoom(
  divisionId: string | AnyColumn,
  institution: Institution,
  userId: string,
): SQL {
  const others = alias(sportRegistration, "others");
  const limit = alias(sportDivision, "limit_division");
  return sql`(select count(*) from ${sportRegistration} as "others" where ${others.divisionId} = ${divisionId} and ${others.institution} = ${institution} and ${others.status} = 'approved' and ${others.userId} <> ${userId}) < coalesce((select ${limit.maxPerInstitution} from ${sportDivision} as "limit_division" where ${limit.id} = ${divisionId}), 1000000)`;
}

/** SQL: every approved registration of `userId` still fits after moving to `institution`. */
export function roomAfterMove(userId: string, institution: Institution): SQL {
  const mine = alias(sportRegistration, "mine");
  return sql`not exists (select 1 from ${sportRegistration} as "mine" where ${mine.userId} = ${userId} and ${mine.status} = 'approved' and not (${approvedRoom(mine.divisionId, institution, userId)}))`;
}

/** Evaluates a condition on its own, for a friendly answer before the guarded batch. */
export async function holds(db: Database, condition: SQL) {
  const row = await db.get<{ ok: number }>(sql`select (${condition}) as ok`);
  return !!row?.ok;
}

/** Approved registrations per division for one institution, for the athlete's page. */
export async function approvedCounts(db: Database, institution: Institution) {
  const rows = await db
    .select({ divisionId: sportRegistration.divisionId, approved: sql<number>`count(*)` })
    .from(sportRegistration)
    .where(
      and(eq(sportRegistration.institution, institution), eq(sportRegistration.status, "approved")),
    )
    .groupBy(sportRegistration.divisionId);
  return Object.fromEntries(rows.map((row) => [row.divisionId, Number(row.approved)]));
}
