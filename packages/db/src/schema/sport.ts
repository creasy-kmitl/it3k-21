import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { DIVISION_FORMATS, DIVISION_GENDERS, SPORT_ICONS } from "../sport-rules";

export * from "../sport-rules";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

const timestamps = () => ({
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/** A main sport type, e.g. กีฬาแบดมินตัน. Athletes register for its divisions. */
export const sport = sqliteTable(
  "sport",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon", { enum: SPORT_ICONS }).notNull().default("general"),
    // Null shows the generated illustration for `icon`.
    thumbnailUrl: text("thumbnail_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("sport_code_uidx").on(table.code),
    check("sport_icon_check", sql`${table.icon} IN (${inList(SPORT_ICONS)})`),
  ],
);

/**
 * A sub type athletes register for, e.g. แบดมินตัน เดี่ยวชาย. The requires*
 * flags decide which extra fields a registration must fill in, so new sports
 * need no code changes.
 */
export const sportDivision = sqliteTable(
  "sport_division",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // No ON DELETE: a sport with divisions cannot be deleted.
    sportId: text("sport_id")
      .notNull()
      .references(() => sport.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    gender: text("gender", { enum: DIVISION_GENDERS }).notNull(),
    format: text("format", { enum: DIVISION_FORMATS }).notNull(),
    // Shirt number (football, basketball).
    requiresShirtNumber: integer("requires_shirt_number", { mode: "boolean" })
      .notNull()
      .default(false),
    // มือ 1 or มือ 2 (badminton singles).
    requiresBadmintonRank: integer("requires_badminton_rank", { mode: "boolean" })
      .notNull()
      .default(false),
    // IGN, its reading, Facebook and a linked Discord account (esports).
    requiresGameProfile: integer("requires_game_profile", { mode: "boolean" })
      .notNull()
      .default(false),
    // Null means no limit on registrations per institution.
    maxPerInstitution: integer("max_per_institution"),
    registrationOpen: integer("registration_open", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("sport_division_code_uidx").on(table.code),
    index("sport_division_sport_id_idx").on(table.sportId),
    check("sport_division_gender_check", sql`${table.gender} IN (${inList(DIVISION_GENDERS)})`),
    check("sport_division_format_check", sql`${table.format} IN (${inList(DIVISION_FORMATS)})`),
    check(
      "sport_division_max_check",
      sql`${table.maxPerInstitution} IS NULL OR ${table.maxPerInstitution} > 0`,
    ),
  ],
);
