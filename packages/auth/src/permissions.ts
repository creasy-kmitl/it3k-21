import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

export const statement = {
  ...defaultStatements,
  department: ["create", "read", "update", "delete", "assign"],
} as const;

export const ac = createAccessControl(statement);

export const staff = ac.newRole({});

export const head = ac.newRole({
  user: ["list", "get"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  // Departments are managed by admins only.
  department: ["create", "read", "update", "delete", "assign"],
});

export const roles = { staff, head, admin };

export type Role = keyof typeof roles;
export const ROLES = Object.keys(roles) as Role[];
export const DEFAULT_ROLE: Role = "staff";

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

export function can(role: string | null | undefined, permissions: Permissions) {
  return parseRoles(role).some((r) => roles[r].authorize(permissions).success);
}
