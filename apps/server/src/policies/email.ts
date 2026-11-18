// Who may write and send staff emails. Senders reach anyone. Every email route asks
// this file, never a department code, seat or institution directly.
//
//   admin                                             anyone
//   member of a department with sendEmail             anyone
//   sendEmailAsLeader, head/vice (KMITL)              anyone
//   everyone else                                     nobody
//
// Seats are KMITL's (mayHoldSeat): a seat holder of another institution, left
// from before that rule, sends nothing. A seat holder without an institution
// counts as KMITL's, as in policies/sports.ts.
import { hasRole, isMember } from "@it3k/auth/permissions";
import { mayHoldSeat } from "@it3k/db/profile";

import type { CurrentUser } from "../middleware/current-user";
import { hasCapability } from "./department-capabilities";
import { sportAccessIsAsRead } from "./sports";

export type EmailActor = Pick<
  CurrentUser,
  "role" | "leadershipRole" | "departmentCode" | "institution" | "banned"
>;

export function canSendEmail(actor: EmailActor | null): boolean {
  if (!actor || actor.banned) return false;
  if (hasRole(actor.role, "admin")) return true;
  if (!isMember(actor.role)) return false;
  if (hasCapability(actor.departmentCode, "sendEmail")) return true;
  if (!hasCapability(actor.departmentCode, "sendEmailAsLeader")) return false;
  // A seat always belongs to the account's own department.
  return actor.leadershipRole !== null && mayHoldSeat(actor.institution);
}

/**
 * SQL on the actor's own `user` row: the role, department, institution, seat
 * and ban that `canSendEmail` read are unchanged. The sport policy checks the
 * same five facts, so it is shared rather than repeated.
 */
export const canSendEmailIsAsRead: (actor: CurrentUser) => ReturnType<typeof sportAccessIsAsRead> =
  sportAccessIsAsRead;
