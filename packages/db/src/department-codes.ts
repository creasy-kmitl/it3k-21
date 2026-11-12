// Shared by the schema, the server and the web form; no Drizzle imports, so the
// web bundle can use it.

// Every department may have a code: a short, stable id that admins choose when
// they create it and that never changes afterwards (lock_department_codes).
export const DEPARTMENT_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DEPARTMENT_CODE_MAX_LENGTH = 32;

// Codes the server grants rights to (apps/server/src/policies/department-capabilities.ts).
// Only a migration may give one to a department; the API refuses them.
export const RESERVED_DEPARTMENT_CODES = ["tech-live", "registration"] as const;
export type ReservedDepartmentCode = (typeof RESERVED_DEPARTMENT_CODES)[number];
