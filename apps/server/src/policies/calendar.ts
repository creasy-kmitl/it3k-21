import { hasRole, isMember } from "@it3k/auth/permissions";
import { user } from "@it3k/db/schema/auth";
import { leadership } from "@it3k/db/schema/leadership";
import { type SQL, sql } from "drizzle-orm";

import type { CurrentUser } from "../middleware/current-user";

type Actor = Pick<CurrentUser, "role" | "banned" | "departmentId" | "leadershipRole">;

function activeMember(actor: Actor | null): actor is Actor {
  return !!actor && !actor.banned && isMember(actor.role);
}

/** Every member reads every department's calendar. */
export function canReadCalendar(actor: Actor | null): boolean {
  return activeMember(actor);
}

/** Admins plan every department's calendar; members plan their own department's. */
export function canEditDepartment(actor: Actor | null, departmentId: string): boolean {
  if (!activeMember(actor)) return false;
  return hasRole(actor.role, "admin") || actor.departmentId === departmentId;
}

/** Whether the actor can add items anywhere: admins, and members with a department. */
export function canCreateItems(actor: Actor | null): boolean {
  if (!activeMember(actor)) return false;
  return hasRole(actor.role, "admin") || actor.departmentId !== null;
}

/**
 * Admins and the department's head and vicehead publish its items. A seat's
 * account always belongs to the seat's department, so a seat plus the
 * department means a seat in that department.
 */
export function canPublishDepartment(actor: Actor | null, departmentId: string): boolean {
  if (!canEditDepartment(actor, departmentId) || !actor) return false;
  return hasRole(actor.role, "admin") || actor.leadershipRole !== null;
}

// The guards below read the `user` row that abortUnless updates, i.e. the
// actor's own, so a batch is rolled back if the actor lost the right after the
// route checked it.

const roleIncludes = (role: string): SQL =>
  sql`(',' || replace(${user.role}, ' ', '') || ',' like ${`%,${role},%`})`;

const notBanned = (): SQL =>
  sql`(coalesce(${user.banned}, 0) = 0 or (${user.banExpires} is not null and ${user.banExpires} <= cast(unixepoch('subsecond') * 1000 as integer)))`;

const holdsSeatIn = (departmentId: string): SQL =>
  sql`exists (select 1 from ${leadership} where ${leadership.userId} = ${user.id} and ${leadership.departmentId} = ${departmentId})`;

/** SQL twin of canEditDepartment, for abortUnless on the actor's row. */
export function stillDepartmentEditor(departmentId: string): SQL {
  return sql`(${notBanned()} and (${roleIncludes("admin")} or (${roleIncludes("staff")} and ${user.departmentId} = ${departmentId})))`;
}

/** SQL twin of canPublishDepartment, for abortUnless on the actor's row. */
export function stillDepartmentPublisher(departmentId: string): SQL {
  return sql`(${notBanned()} and (${roleIncludes("admin")} or (${roleIncludes("staff")} and ${user.departmentId} = ${departmentId} and ${holdsSeatIn(departmentId)})))`;
}

/** SQL: the actor is still an unbanned admin, for admin-only writes. */
export function stillAdmin(): SQL {
  return sql`(${notBanned()} and ${roleIncludes("admin")})`;
}
