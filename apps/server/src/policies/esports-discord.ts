// Who the esports Discord is for. The /me Discord card is shown to them only,
// and the bot (routes/bot) gives its Staff role by the same rule.
//
//   admin                                              staff
//   member of a department with esportsDiscordStaff    staff (Tech/Live and กีฬา, heads included)
//   anyone with an esports registration not rejected   athlete
//   everyone else                                      not shown
import { hasRole, isMember } from "@it3k/auth/permissions";
import type { Database } from "@it3k/db";
import { sportDivision, sportRegistration } from "@it3k/db/schema/sport";
import { and, eq, ne } from "drizzle-orm";

import type { CurrentUser } from "../middleware/current-user";
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
