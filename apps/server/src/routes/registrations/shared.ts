import type { Database } from "@it3k/db";
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
import { and, eq } from "drizzle-orm";

import { type CurrentUser, constraintMessage } from "../../middleware/current-user";

export const DISCORD = "discord";

/** Looks up the linked Discord account's username; null when it cannot. */
export type DiscordProfile = (
  headers: Headers,
  accountRecordId: string,
) => Promise<{ username: string } | null>;

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
      sport: { id: sport.id, code: sport.code, name: sport.name, icon: sport.icon },
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
