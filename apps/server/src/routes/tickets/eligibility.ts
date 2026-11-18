// Who may claim which ticket type. A type's rules are lists (roles,
// institutions, sports) plus "only athletes this event expects"; an empty
// list allows anyone, and a claimer must pass every rule that is set.
import type { Database } from "@it3k/db";
import { parseRoles } from "@it3k/auth/permissions";
import { user } from "@it3k/db/schema/auth";
import { event, eventTicket, eventTicketType } from "@it3k/db/schema/event";
import { userProfile } from "@it3k/db/schema/profile";
import { sportDivision, sportRegistration } from "@it3k/db/schema/sport";
import { type SQL, and, eq, sql } from "drizzle-orm";

import { expectedAt } from "../events/checkins";

export type TicketTypeRow = typeof eventTicketType.$inferSelect;

/** What the rules look at about one account. */
export type Claimer = {
  roles: string[];
  institution: string | null;
  /** Sports they have an approved registration in. */
  sportIds: Set<string>;
};

export async function loadClaimer(db: Database, userId: string): Promise<Claimer> {
  const [row] = await db
    .select({ role: user.role, institution: user.institution, profile: userProfile.values })
    .from(user)
    .leftJoin(userProfile, eq(userProfile.userId, user.id))
    .where(eq(user.id, userId));
  const sports = await db
    .selectDistinct({ id: sportDivision.sportId })
    .from(sportRegistration)
    .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
    .where(and(eq(sportRegistration.userId, userId), eq(sportRegistration.status, "approved")));
  return {
    roles: parseRoles(row?.role),
    institution: row?.institution ?? (row?.profile?.institution || null),
    sportIds: new Set(sports.map((sport) => sport.id)),
  };
}

export type RuleRefusal = "not-listed" | "not-eligible";

/**
 * Which rule of `type` keeps `claimer` out, or null when they pass them all.
 * `listed` is whether the event expects them as an athlete.
 */
export function ruleRefusal(
  type: Pick<
    TicketTypeRow,
    "listedOnly" | "allowedRoles" | "allowedInstitutions" | "allowedSportIds"
  >,
  claimer: Claimer,
  listed: boolean,
): RuleRefusal | null {
  if (type.listedOnly && !listed) return "not-listed";
  const roles = type.allowedRoles;
  if (roles.length > 0 && !roles.some((role) => claimer.roles.includes(role))) {
    return "not-eligible";
  }
  const institutions: readonly string[] = type.allowedInstitutions;
  if (
    institutions.length > 0 &&
    !(claimer.institution && institutions.includes(claimer.institution))
  ) {
    return "not-eligible";
  }
  const sports = type.allowedSportIds;
  if (sports.length > 0 && !sports.some((id) => claimer.sportIds.has(id))) return "not-eligible";
  return null;
}

/** SQL: tickets of the type handed out. */
export const typeCountOf = (typeId: string | SQL) =>
  sql<number>`(select count(*) from ${eventTicket} where ${eventTicket.ticketTypeId} = ${typeId})`;

/** SQL: tickets of the event handed out. */
export const eventCountOf = (eventId: string | SQL) =>
  sql<number>`(select count(*) from ${eventTicket} where ${eventTicket.eventId} = ${eventId})`;

/**
 * SQL: `userId` may claim one more ticket of `typeId` now. The same checks as
 * `ruleRefusal` and the claim route, run inside the write's batch so nothing
 * read earlier can have changed.
 */
export function claimableSql(eventId: string, typeId: string, userId: string, now: Date): SQL {
  const roleList = sql`',' || replace(coalesce(${user.role}, 'guest'), ' ', '') || ','`;
  return sql`exists (
    select 1 from ${event}
    join ${eventTicketType} on ${eventTicketType.eventId} = ${event.id}
    where ${event.id} = ${eventId} and ${eventTicketType.id} = ${typeId}
      and ${event.ticketsOpen} = 1
      and ${event.endAt} > ${now.getTime()}
      and ${eventTicketType.open} = 1
      and (${event.ticketCapacity} is null or ${eventCountOf(eventId)} < ${event.ticketCapacity})
      and (${eventTicketType.capacity} is null or ${typeCountOf(typeId)} < ${eventTicketType.capacity})
      and (select count(*) from ${eventTicket} where ${eventTicket.ticketTypeId} = ${typeId} and ${eventTicket.userId} = ${userId}) < ${eventTicketType.maxPerUser}
      and (${eventTicketType.listedOnly} = 0 or ${expectedAt(eventId, userId)})
      and (json_array_length(${eventTicketType.allowedRoles}) = 0 or exists (
        select 1 from json_each(${eventTicketType.allowedRoles}) as allowed, ${user}
        where ${user.id} = ${userId} and instr(${roleList}, ',' || allowed.value || ',') > 0
      ))
      and (json_array_length(${eventTicketType.allowedInstitutions}) = 0 or exists (
        select 1 from json_each(${eventTicketType.allowedInstitutions}) as allowed, ${user}
        left join ${userProfile} on ${userProfile.userId} = ${user.id}
        where ${user.id} = ${userId}
          and allowed.value = coalesce(${user.institution}, nullif(json_extract(${userProfile.values}, '$.institution'), ''))
      ))
      and (json_array_length(${eventTicketType.allowedSportIds}) = 0 or exists (
        select 1 from ${sportRegistration}
        join ${sportDivision} on ${sportDivision.id} = ${sportRegistration.divisionId}
        where ${sportRegistration.userId} = ${userId} and ${sportRegistration.status} = 'approved'
          and ${sportDivision.sportId} in (select value from json_each(${eventTicketType.allowedSportIds}))
      ))
  )`;
}
