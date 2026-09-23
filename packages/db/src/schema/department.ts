import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const DEPARTMENT_CODES = ["tech-live", "registration"] as const;
export type DepartmentCode = (typeof DEPARTMENT_CODES)[number];

export const department = sqliteTable(
  "department",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull().unique(),
    description: text("description"),
    // Stable identity for departments the app treats specially; names can be
    // renamed by admins, codes cannot drift with them.
    code: text("code", { enum: DEPARTMENT_CODES }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("department_code_uidx").on(table.code)],
);
