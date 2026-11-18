import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { ASSIGN_KINDS, DEPARTMENT_KINDS } from "../invitation-rules";
import type { Institution } from "../profile";
import { user } from "./auth";
import { department } from "./department";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// Lets someone whose address is outside the institution domains sign in with
// Google for the first time (packages/auth), and says what their new account
// becomes. An invitation is open until it is accepted, revoked or expires; at
// most one is open per address.
export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Always lowercase (normalizeEmail), so it compares with user.email as stored.
    email: text("email").notNull(),
    kind: text("kind", { enum: ASSIGN_KINDS }).notNull(),
    // Required for staff and seats, empty otherwise. Deleting the department
    // drops its open invitations with it.
    departmentId: text("department_id").references(() => department.id, { onDelete: "cascade" }),
    // Copied to the new account's user.institution (INSTITUTION_IDS). Like
    // that column, no CHECK; the API validates it.
    institution: text("institution").$type<Institution>(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedUserId: text("accepted_user_id").references(() => user.id, { onDelete: "set null" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("invitation_open_email_uidx")
      .on(table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    index("invitation_created_idx").on(table.createdAt),
    check("invitation_kind_check", sql`${table.kind} IN (${inList(ASSIGN_KINDS)})`),
    check(
      "invitation_department_check",
      sql`(${table.kind} IN (${inList(DEPARTMENT_KINDS)})) = (${table.departmentId} IS NOT NULL)`,
    ),
  ],
);
