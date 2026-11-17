// Who may write and send staff emails, and to whom. Every email route asks
// this file, never a department code, seat or institution directly.
//
//   admin                                             anyone
//   member of a department with sendEmail             anyone
//   sendEmailAsLeader, host institution, head/vice    anyone
//   sendEmailAsLeader, other institution, head/vice   people of their own institution
//   everyone else                                     nobody
import { hasRole, isMember } from "@it3k/auth/permissions";
import { HOST_INSTITUTION, type Institution } from "@it3k/db/profile";

import type { CurrentUser } from "../middleware/current-user";
import { hasCapability } from "./department-capabilities";
import { sportAccessIsAsRead } from "./sports";

export type EmailScope = { kind: "all" } | { kind: "institution"; institution: Institution };

export type EmailActor = Pick<
  CurrentUser,
  "role" | "leadershipRole" | "departmentCode" | "institution" | "banned"
>;

export function emailAccess(actor: EmailActor | null): EmailScope | null {
  if (!actor || actor.banned) return null;
  if (hasRole(actor.role, "admin")) return { kind: "all" };
  if (!isMember(actor.role)) return null;
  if (hasCapability(actor.departmentCode, "sendEmail")) return { kind: "all" };
  if (!hasCapability(actor.departmentCode, "sendEmailAsLeader")) return null;
  // A seat always belongs to the account's own department.
  if (!actor.leadershipRole || !actor.institution) return null;
  if (actor.institution === HOST_INSTITUTION) return { kind: "all" };
  return { kind: "institution", institution: actor.institution };
}

/**
 * SQL on the actor's own `user` row: the role, department, institution, seat
 * and ban that `emailAccess` read are unchanged. The sport policy checks the
 * same five facts, so it is shared rather than repeated.
 */
export const emailAccessIsAsRead: (actor: CurrentUser) => ReturnType<typeof sportAccessIsAsRead> =
  sportAccessIsAsRead;
