import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { PresetDesign } from "../qr-preset-rules";
import { user } from "./auth";

export * from "../qr-preset-rules";

/**
 * A named QR design every member can apply in QR Studio, so the team's
 * printed QR codes look alike. Whoever saved it edits it, as do admins and
 * Tech/Live.
 */
export const qrPreset = sqliteTable(
  "qr_preset",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    design: text("design", { mode: "json" }).$type<PresetDesign>().notNull(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("qr_preset_name_idx").on(table.name)],
);
