import { hasRole } from "@it3k/auth/permissions";
import type { DepartmentCode } from "@it3k/db/schema/department";

// Loaded fresh from the database on every request -- never from the client.
export type Actor = {
  id: string;
  role: string | null;
  departmentCode: DepartmentCode | null;
  banned: boolean;
};
export type Target = { userId: string | null };
export type Action = "create" | "update" | "delete" | "attach" | "reveal";

function isLeader(actor: Actor) {
  return hasRole(actor.role, "head") || hasRole(actor.role, "vicehead");
}

/** Admins, and heads/viceheads of Tech/Live or ทะเบียน, manage every seat. */
export function isManager(actor: Actor | null): boolean {
  if (!actor || actor.banned) return false;
  if (hasRole(actor.role, "admin")) return true;
  return isLeader(actor) && actor.departmentCode !== null;
}

export function allowed(actor: Actor | null, action: Action, target?: Target): boolean {
  if (!actor || actor.banned) return false;
  // Every signed-in user may ask for contact details; the route audits it.
  if (action === "reveal") return true;
  if (isManager(actor)) return true;
  // Other leaders may edit the personal fields of the seat they hold.
  return action === "update" && isLeader(actor) && target?.userId === actor.id;
}
