import { hasRole, isMember } from "@it3k/auth/permissions";
import type { DepartmentCode } from "@it3k/db/schema/department";
import type { LeadershipRole } from "@it3k/db/schema/leadership";
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { DEPARTMENT_CODES, department } from "@it3k/db/schema/department";
import { and, eq, exists, inArray, sql } from "drizzle-orm";
import type { CurrentUser } from "../middleware/current-user";
import { notBanned } from "./actor-sql";

// Loaded fresh from the database on every request -- never from the client.
export type Actor = {
  id: string;
  role: string | null;
  /** The seat the actor holds. A seat's account always belongs to the seat's department. */
  leadershipRole: LeadershipRole | null;
  departmentCode: DepartmentCode | null;
  banned: boolean;
};
export type Target = { userId: string | null };
export type Action = "create" | "update" | "delete" | "attach" | "reveal";

function isLeader(actor: Actor) {
  return actor.leadershipRole !== null;
}

/**
 * Admins, and every member (staff, head or vicehead) of Tech/Live or ทะเบียน,
 * manage every seat and every account's department.
 */
export function isManager(actor: Actor | null): boolean {
  if (!actor || actor.banned) return false;
  if (hasRole(actor.role, "admin")) return true;
  return isMember(actor.role) && actor.departmentCode !== null;
}

/** Recheck the actor before a write can change their own management rights. */
export function managerIsAsRead(db: Database, actor: CurrentUser) {
  return (
    and(
      notBanned(),
      eq(user.role, actor.role ?? ""),
      actor.departmentId
        ? eq(user.departmentId, actor.departmentId)
        : sql`${user.departmentId} is null`,
      hasRole(actor.role, "admin")
        ? sql`1`
        : exists(
            db
              .select({ id: department.id })
              .from(department)
              .where(
                and(
                  eq(department.id, user.departmentId),
                  inArray(department.code, DEPARTMENT_CODES),
                ),
              ),
          ),
    ) ?? sql`0`
  );
}

/** Only admins may change an admin's account: role, department or seat. */
export function canChangeAccount(actor: Actor | null, targetRole: string | null): boolean {
  return !hasRole(targetRole, "admin") || canGrantAdmin(actor);
}

/** Only admins make or unmake admins. */
export function canGrantAdmin(actor: Actor | null): boolean {
  return !!actor && !actor.banned && hasRole(actor.role, "admin");
}

export function allowed(actor: Actor | null, action: Action, target?: Target): boolean {
  if (!actor || actor.banned || !isMember(actor.role)) return false;
  // Every member may ask for contact details; the route audits it.
  if (action === "reveal") return true;
  if (isManager(actor)) return true;
  // Other leaders may edit the personal fields of the seat they hold.
  return action === "update" && isLeader(actor) && target?.userId === actor.id;
}
