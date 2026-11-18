// Shared by the schema, the server, the auth hooks and the web form; no Drizzle
// imports, so the web bundle can use it.

/** What an account can be made into, by an assignment or by an invitation. Admin is separate. */
export const ASSIGN_KINDS = [
  "guest",
  "participant",
  "athlete",
  "staff",
  "head",
  "vicehead",
] as const;
export type AssignKind = (typeof ASSIGN_KINDS)[number];

/** Kinds that belong to a department: staff of it, or one of its seats. */
export const DEPARTMENT_KINDS = [
  "staff",
  "head",
  "vicehead",
] as const satisfies readonly AssignKind[];

export function needsDepartment(kind: AssignKind) {
  return (DEPARTMENT_KINDS as readonly string[]).includes(kind);
}

/** The account role a kind stores: seats are not roles, so a head or vicehead is staff. */
export function roleForKind(kind: AssignKind): "guest" | "participant" | "athlete" | "staff" {
  return needsDepartment(kind) ? "staff" : (kind as "guest" | "participant" | "athlete");
}

/** How long an invitation stays open, from when it is sent (or resent). */
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
