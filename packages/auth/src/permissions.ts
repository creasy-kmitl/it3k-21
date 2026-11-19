import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

export const statement = {
  ...defaultStatements,
  department: ["create", "read", "update", "delete", "assign"],
} as const;

export const ac = createAccessControl(statement);

// New sign-ins register as participants or receive staff access from a manager.
export const guest = ac.newRole({});

// Registration and athlete eligibility are separate from staff access.
export const athlete = ac.newRole({});
export const participant = ac.newRole({});

export const staff = ac.newRole({});

// Heads and viceheads are not account roles: holding a seat in the
// `leadership` table is what makes someone one, and the server's leadership
// policy derives their rights from that seat. They get no Better Auth grants --
// `user: ["list"]` would open /api/auth/admin/list-users, emails included.

export const admin = ac.newRole({
  ...adminAc.statements,
  // Departments are managed by admins only.
  department: ["create", "read", "update", "delete", "assign"],
});

export const roles = { guest, participant, athlete, staff, admin };

export type Role = keyof typeof roles;
export const ROLES = Object.keys(roles) as Role[];
export const DEFAULT_ROLE: Role = "guest";

type Permissions = { [K in keyof typeof statement]?: (typeof statement)[K][number][] };

export function parseRoles(role: string | null | undefined): Role[] {
  return (role ?? DEFAULT_ROLE)
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is Role => r in roles);
}

export function hasRole(role: string | null | undefined, target: Role) {
  return parseRoles(role).includes(target);
}

/** Staff workspace membership; profile and file access require only sign-in. */
export function isMember(role: string | null | undefined) {
  return hasRole(role, "admin") || hasRole(role, "staff");
}

export function can(role: string | null | undefined, permissions: Permissions) {
  return parseRoles(role).some((r) => roles[r].authorize(permissions).success);
}
