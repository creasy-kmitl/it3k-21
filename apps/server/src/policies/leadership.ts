import { hasRole, isMember } from "@it3k/auth/permissions";
import { ASSIGN_KINDS, type AssignKind } from "@it3k/db/invitation-rules";
import { HOST_INSTITUTION, mayHoldSeat } from "@it3k/db/profile";
import { type LeadershipRole, leadership } from "@it3k/db/schema/leadership";
import { user } from "@it3k/db/schema/auth";
import { and, eq, sql } from "drizzle-orm";
import type { CurrentUser } from "../middleware/current-user";
import { notBanned } from "./actor-sql";
import { hasCapability, inDepartmentWith } from "./department-capabilities";

// Loaded fresh from the database on every request -- never from the client.
export type Actor = {
  id: string;
  role: string | null;
  /** The seat the actor holds. A seat's account always belongs to the seat's department. */
  leadershipRole: LeadershipRole | null;
  departmentCode: string | null;
  /** Seats are KMITL's (mayHoldSeat); a seat held from before that rule grants no full rights. */
  institution?: string | null;
  banned: boolean;
};
export type Target = { userId: string | null };
export type Action = "create" | "update" | "delete" | "attach" | "reveal";

function isLeader(actor: Actor) {
  return actor.leadershipRole !== null;
}

/**
 * Admins, and every member (staff, head or vicehead) of a department whose code
 * grants manageAccounts (Tech/Live, ทะเบียน), manage every seat and every
 * account's department.
 */
export function isManager(actor: Actor | null): boolean {
  if (!actor || actor.banned) return false;
  if (hasRole(actor.role, "admin")) return true;
  return isMember(actor.role) && hasCapability(actor.departmentCode, "manageAccounts");
}

/** Recheck the actor before a write can change their own management rights. */
export function managerIsAsRead(actor: CurrentUser) {
  return (
    and(
      notBanned(),
      eq(user.role, actor.role ?? ""),
      actor.departmentId
        ? eq(user.departmentId, actor.departmentId)
        : sql`${user.departmentId} is null`,
      hasRole(actor.role, "admin") ? sql`1` : inDepartmentWith("manageAccounts"),
    ) ?? sql`0`
  );
}

/**
 * Who may make an account (or an invited address) into what. Admins, and the
 * heads and viceheads of a department that grants manageAccounts, may give
 * every kind; that department's other staff may only make someone a guest.
 * Admin itself is granted separately (canGrantAdmin).
 */
export function hasFullAssignRights(actor: Actor | null): boolean {
  if (!actor || actor.banned) return false;
  if (hasRole(actor.role, "admin")) return true;
  return isManager(actor) && isLeader(actor) && mayHoldSeat(actor.institution ?? null);
}

export function assignableKinds(actor: Actor | null): AssignKind[] {
  if (hasFullAssignRights(actor)) return [...ASSIGN_KINDS];
  return isManager(actor) ? ["guest"] : [];
}

/** The account an assignment changes: its stored role and the seat it holds. */
export type AssignTarget = { role: string | null; seatRole: LeadershipRole | null };

/**
 * Whether `actor` may give `kind`: to an invited address when `target` is
 * omitted, otherwise to that account. Staff with guest-only rights may not
 * touch members or seat holders, so they cannot demote anyone to guest.
 */
export function canAssign(actor: Actor | null, kind: AssignKind, target?: AssignTarget): boolean {
  if (!assignableKinds(actor).includes(kind)) return false;
  if (!target) return true;
  if (!canChangeAccount(actor, target.role)) return false;
  if (hasFullAssignRights(actor)) return true;
  return !isMember(target.role) && target.seatRole === null;
}

/**
 * Recheck, inside the batch, everything canAssign read about the actor: their
 * role and department (managerIsAsRead) and, when their rights come from a
 * seat, that they still hold it.
 */
export function assignerIsAsRead(actor: CurrentUser): ReturnType<typeof sql> {
  const seat =
    !hasRole(actor.role, "admin") && actor.leadershipRole
      ? sql`exists (select 1 from ${leadership} where ${leadership.userId} = ${actor.id} and ${leadership.role} = ${actor.leadershipRole}) and (${user.institution} is null or ${user.institution} = ${HOST_INSTITUTION})`
      : sql`1`;
  return and(managerIsAsRead(actor), seat) ?? sql`0`;
}

/** Only admins may change an admin's account: role, department or seat. */
export function canChangeAccount(actor: Actor | null, targetRole: string | null): boolean {
  return !hasRole(targetRole, "admin") || canGrantAdmin(actor);
}

/** Only admins make or unmake admins. */
export function canGrantAdmin(actor: Actor | null): boolean {
  return !!actor && !actor.banned && hasRole(actor.role, "admin");
}

/**
 * Seats are managed -- created, deleted, attached to an account, moved -- by
 * those with full assignment rights: admins and the heads and viceheads of
 * Tech/Live and ทะเบียน. Any other leader may edit the personal fields of the
 * seat they hold (the route limits which fields).
 */
export function allowed(actor: Actor | null, action: Action, target?: Target): boolean {
  if (!actor || actor.banned || !isMember(actor.role)) return false;
  if (action === "reveal") return false; // see canRevealContact
  if (hasFullAssignRights(actor)) return true;
  return action === "update" && isLeader(actor) && target?.userId === actor.id;
}

/** Whether a seat's contact details are the actor's to see; the route audits every look. */
export function canRevealContact(
  actor: (Actor & { departmentId: string | null }) | null,
  seatDepartmentId: string,
): boolean {
  if (!actor || actor.banned || !isMember(actor.role)) return false;
  // Admins and every leader see every leader's details, to work together.
  if (hasRole(actor.role, "admin") || isLeader(actor)) return true;
  // Staff see the head and vicehead of their own department.
  return actor.departmentId === seatDepartmentId;
}
