import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { department } from "./department";

export const LEADERSHIP_ROLES = ["head", "vicehead"] as const;
export type LeadershipRole = (typeof LEADERSHIP_ROLES)[number];

export const SOCIAL_PLATFORMS = ["facebook", "instagram", "line", "discord", "other"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// One row per seat: a department has at most one head and one vicehead. The
// seat outlives whoever holds it, so a deleted account detaches (set null)
// rather than removing the seat, and a department cannot be deleted while it
// still has seats (the FK has no ON DELETE action, so SQLite restricts it).
export const leadership = sqliteTable(
  "leadership",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id),
    role: text("role", { enum: LEADERSHIP_ROLES }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // Shown for unattached seats; attached seats display the account's name.
    name: text("name").notNull(),
    nickname: text("nickname"),
    phone: text("phone"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Also serves lookups by department (leading column).
    uniqueIndex("leadership_seat_uidx").on(table.departmentId, table.role),
    uniqueIndex("leadership_user_uidx").on(table.userId),
    check("leadership_role_check", sql`${table.role} IN (${inList(LEADERSHIP_ROLES)})`),
  ],
);

export const leadershipSocial = sqliteTable(
  "leadership_social",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    leadershipId: text("leadership_id")
      .notNull()
      .references(() => leadership.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: SOCIAL_PLATFORMS }).notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    uniqueIndex("leadership_social_platform_uidx").on(table.leadershipId, table.platform),
    check(
      "leadership_social_platform_check",
      sql`${table.platform} IN (${inList(SOCIAL_PLATFORMS)})`,
    ),
  ],
);
