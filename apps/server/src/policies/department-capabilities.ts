// What each department code grants. This is the only place that maps a code
// to rights: policies ask for a capability, never for a code by name. Every
// department may have a code, but only the reserved codes listed here grant
// anything. Codes live in the database, where triggers keep them from being
// changed and keep coded departments from being deleted (lock_department_codes).
import { user } from "@it3k/db/schema/auth";
import {
  type ReservedDepartmentCode,
  RESERVED_DEPARTMENT_CODES,
  department,
} from "@it3k/db/schema/department";
import { type SQL, inArray, sql } from "drizzle-orm";

export type Capability =
  | "manageAccounts"
  | "manageShortLinks"
  // Every member runs the whole sport system (policies/sports.ts).
  | "runSports"
  // Members work on athlete registrations; how far depends on their seat
  // and institution (policies/sports.ts).
  | "registerAthletes";

export const DEPARTMENT_CAPABILITIES = {
  // manageAccounts: assign departments, seats and roles to any non-admin account.
  "tech-live": ["manageAccounts", "manageShortLinks", "runSports"],
  registration: ["manageAccounts", "registerAthletes"],
} as const satisfies Record<ReservedDepartmentCode, readonly Capability[]>;

function isReserved(code: string): code is ReservedDepartmentCode {
  return (RESERVED_DEPARTMENT_CODES as readonly string[]).includes(code);
}

/** Whether a department's code grants `capability`. Unreserved codes grant nothing. */
export function hasCapability(code: string | null, capability: Capability): boolean {
  if (code === null || !isReserved(code)) return false;
  const granted: readonly Capability[] = DEPARTMENT_CAPABILITIES[code];
  return granted.includes(capability);
}

/** Every code that grants `capability`. */
export function codesWith(capability: Capability): ReservedDepartmentCode[] {
  return RESERVED_DEPARTMENT_CODES.filter((code) => hasCapability(code, capability));
}

/** SQL on the actor's `user` row: its department grants `capability`. */
export function inDepartmentWith(capability: Capability): SQL {
  const codes = codesWith(capability);
  if (codes.length === 0) return sql`0`;
  return sql`${user.departmentId} in (select ${department.id} from ${department} where ${inArray(department.code, codes)})`;
}
