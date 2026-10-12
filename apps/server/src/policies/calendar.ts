import { hasRole, isMember } from "@it3k/auth/permissions";
import { user } from "@it3k/db/schema/auth";
import { type SQL, sql } from "drizzle-orm";

import type { CurrentUser } from "../middleware/current-user";
import { notBanned, roleIncludes } from "./actor-sql";

type Actor = Pick<CurrentUser, "role" | "banned" | "departmentId">;

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

// The guards below read the `user` row that abortUnless updates, i.e. the
// actor's own, so a batch is rolled back if the actor lost the right after the
// route checked it.

/** SQL twin of canEditDepartment, for abortUnless on the actor's row. */
export function stillDepartmentEditor(departmentId: string): SQL {
  return sql`(${notBanned()} and (${roleIncludes("admin")} or (${roleIncludes("staff")} and ${user.departmentId} = ${departmentId})))`;
}

/** SQL: the actor is still an unbanned admin, for admin-only writes. */
export function stillAdmin(): SQL {
  return sql`(${notBanned()} and ${roleIncludes("admin")})`;
}
