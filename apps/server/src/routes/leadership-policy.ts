import { hasRole, isMember } from "@it3k/auth/permissions";
import type { DepartmentCode } from "@it3k/db/schema/department";
import type { LeadershipRole } from "@it3k/db/schema/leadership";

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
