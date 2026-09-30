import { hasRole, isMember } from "@it3k/auth/permissions";
import { user } from "@it3k/db/schema/auth";
import { department } from "@it3k/db/schema/department";
import { leadership } from "@it3k/db/schema/leadership";
import { type SQL, sql } from "drizzle-orm";

import type { CurrentUser } from "../middleware/current-user";
import type { Actor } from "./leadership";

const TECH_LIVE = "tech-live";

/** Admins and every Tech/Live member plan the calendar; other members read it. */
export function canEditCalendar(actor: Actor | null): boolean {
  if (!actor || actor.banned || !isMember(actor.role)) return false;
  return hasRole(actor.role, "admin") || actor.departmentCode === TECH_LIVE;
}

/**
 * Admins and Tech/Live's head and vicehead approve: they publish items and
 * change who can see them. A seat's account always belongs to the seat's
 * department, so a seat plus a Tech/Live account means a Tech/Live seat.
 */
export function canApproveCalendar(actor: Actor | null): boolean {
  if (!canEditCalendar(actor) || !actor) return false;
  return hasRole(actor.role, "admin") || actor.leadershipRole !== null;
}

// The guards below read the `user` row that abortUnless updates, i.e. the
// actor's own, so a batch is rolled back if the actor lost the right after the
// route checked it.

const roleIncludes = (role: string): SQL =>
  sql`(',' || replace(${user.role}, ' ', '') || ',' like ${`%,${role},%`})`;

const notBanned = (): SQL =>
  sql`(coalesce(${user.banned}, 0) = 0 or (${user.banExpires} is not null and ${user.banExpires} <= cast(unixepoch('subsecond') * 1000 as integer)))`;

const inTechLive = (): SQL =>
  sql`(select ${department.code} from ${department} where ${department.id} = ${user.departmentId}) = ${TECH_LIVE}`;

const holdsTechLiveSeat = (): SQL =>
  sql`exists (select 1 from ${leadership} inner join ${department} on ${department.id} = ${leadership.departmentId} where ${leadership.userId} = ${user.id} and ${department.code} = ${TECH_LIVE})`;

/** SQL twin of canEditCalendar, for abortUnless on the actor's row. */
export function stillCalendarEditor(): SQL {
  return sql`(${notBanned()} and (${roleIncludes("admin")} or (${roleIncludes("staff")} and ${inTechLive()})))`;
}

/** SQL twin of canApproveCalendar, for abortUnless on the actor's row. */
export function stillCalendarApprover(): SQL {
  return sql`(${notBanned()} and (${roleIncludes("admin")} or (${roleIncludes("staff")} and ${inTechLive()} and ${holdsTechLiveSeat()})))`;
}

/**
 * Members of an involved department answer what Tech/Live asked of it;
 * editors may record an answer on the department's behalf.
 */
export function canAnswerRequest(actor: CurrentUser | null, departmentId: string): boolean {
  if (canEditCalendar(actor)) return true;
  return !!actor && !actor.banned && isMember(actor.role) && actor.departmentId === departmentId;
}

/** Editors, the assignee and the assigned department may tick an action item off. */
export function canCompleteActionItem(
  actor: CurrentUser | null,
  action: { ownerId: string | null; departmentId: string | null },
): boolean {
  if (canEditCalendar(actor)) return true;
  if (!actor || actor.banned || !isMember(actor.role)) return false;
  return (
    action.ownerId === actor.id ||
    (action.departmentId !== null && action.departmentId === actor.departmentId)
  );
}

/** SQL: the actor is still an unbanned member. */
export function stillMember(): SQL {
  return sql`(${notBanned()} and (${roleIncludes("admin")} or ${roleIncludes("staff")}))`;
}

/** SQL: the actor is still an unbanned member of this department. */
export function stillInDepartment(departmentId: string): SQL {
  return sql`(${stillMember()} and ${user.departmentId} = ${departmentId})`;
}
