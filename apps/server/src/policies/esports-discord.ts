// Who the esports Discord is for. The /me Discord card is shown to them only,
// and the bot (routes/bot) gives its Staff role by the same rule.
//
//   admin                                              staff
//   member of a department with esportsDiscordStaff    staff (Tech/Live and กีฬา, heads included)
//   anyone with an esports registration not rejected   athlete
//   everyone else                                      not shown
import { hasRole, isMember } from "@it3k/auth/permissions";
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { department } from "@it3k/db/schema/department";
import { sportDivision, sportRegistration } from "@it3k/db/schema/sport";
import { and, eq, ne } from "drizzle-orm";

import { type CurrentUser, isBanned } from "../middleware/current-user";
import { hasCapability } from "./department-capabilities";

export type EsportsDiscordActor = Pick<CurrentUser, "role" | "departmentCode" | "banned">;

export function isEsportsDiscordStaff(actor: EsportsDiscordActor | null): boolean {
  if (!actor || actor.banned) return false;
  if (hasRole(actor.role, "admin")) return true;
  return isMember(actor.role) && hasCapability(actor.departmentCode, "esportsDiscordStaff");
}

/** Has entered an esports division (one that asks for a game profile) and was not turned down. */
export async function isEsportsEntrant(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sportRegistration.id })
    .from(sportRegistration)
    .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
    .where(
      and(
        eq(sportRegistration.userId, userId),
        eq(sportDivision.requiresGameProfile, true),
        ne(sportRegistration.status, "rejected"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type EsportsDiscordAudience = { staff: boolean; athlete: boolean };

export function inEsportsDiscord(audience: EsportsDiscordAudience): boolean {
  return audience.staff || audience.athlete;
}

/**
 * The same audience, for code that runs outside a request's requireUser (the
 * Discord link hook, which joins the account to the guild only if it belongs).
 */
export async function esportsDiscordAudience(
  db: Database,
  userId: string,
): Promise<EsportsDiscordAudience> {
  const [row] = await db
    .select({
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires,
      departmentCode: department.code,
    })
    .from(user)
    .leftJoin(department, eq(department.id, user.departmentId))
    .where(eq(user.id, userId));
  if (!row || isBanned(row)) return { staff: false, athlete: false };
  return {
    staff: isEsportsDiscordStaff({
      role: row.role,
      departmentCode: row.departmentCode,
      banned: false,
    }),
    athlete: await isEsportsEntrant(db, userId),
  };
}
