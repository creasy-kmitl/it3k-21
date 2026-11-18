// Who may run the departments page: create, edit and delete departments and
// move accounts between them. Admins, and the heads and viceheads of a
// department granted manageDepartmentsAsLeader (ทะเบียน) whose account is KMITL's.
import { hasRole, isMember } from "@it3k/auth/permissions";
import { HOST_INSTITUTION } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import { leadership } from "@it3k/db/schema/leadership";
import { type SQL, and, eq, sql } from "drizzle-orm";

import type { CurrentUser } from "../middleware/current-user";
import { notBanned } from "./actor-sql";
import { hasCapability } from "./department-capabilities";

export type DepartmentActor = Pick<
  CurrentUser,
  "role" | "leadershipRole" | "departmentCode" | "institution" | "banned"
>;

export function canManageDepartments(actor: DepartmentActor | null): boolean {
  if (!actor || actor.banned) return false;
  if (hasRole(actor.role, "admin")) return true;
  return (
    isMember(actor.role) &&
    actor.leadershipRole !== null &&
    actor.institution === HOST_INSTITUTION &&
    hasCapability(actor.departmentCode, "manageDepartmentsAsLeader")
  );
}

/**
 * SQL on the actor's own `user` row: what canManageDepartments read is
 * unchanged. Pass to abortUnless so a batch rolls back if the right was lost.
 */
export function departmentManagerIsAsRead(actor: CurrentUser): SQL {
  const base = [notBanned(), eq(user.role, actor.role ?? "")];
  if (hasRole(actor.role, "admin")) return and(...base) ?? sql`0`;
  return (
    and(
      ...base,
      actor.departmentId ? eq(user.departmentId, actor.departmentId) : sql`0`,
      eq(user.institution, HOST_INSTITUTION),
      sql`exists (select 1 from ${leadership} where ${leadership.userId} = ${user.id} and ${leadership.role} = ${actor.leadershipRole})`,
    ) ?? sql`0`
  );
}
