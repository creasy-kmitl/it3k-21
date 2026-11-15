import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { Institution } from "../profile";
import {
  DIVISION_FORMATS,
  DIVISION_GENDERS,
  REGISTRATION_CHANGE_ACTIONS,
  REGISTRATION_STATUSES,
  SPORT_ICONS,
} from "../sport-rules";
import { user } from "./auth";

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

/** Created on an account's first registration, which must give the student id. */
export const athlete = sqliteTable("athlete", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull(),
  ...timestamps(),
});

const notRejected = sql`status <> 'rejected'`;

/** One account in one division, with the division's extra fields. */
export const sportRegistration = sqliteTable(
  "sport_registration",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // No ON DELETE: a division with registrations cannot be deleted.
    divisionId: text("division_id")
      .notNull()
      .references(() => sportDivision.id),
    // Copied from user.institution when registering, and kept in step when
    // staff change it. Scopes what registration staff see, and makes shirt
    // numbers and badminton ranks unique per team.
    institution: text("institution").$type<Institution>().notNull(),
    status: text("status", { enum: REGISTRATION_STATUSES }).notNull().default("review"),
    shirtNumber: integer("shirt_number"),
    badmintonRank: integer("badminton_rank"),
    ign: text("ign").notNull().default(""),
    ignReading: text("ign_reading").notNull().default(""),
    facebookUrl: text("facebook_url").notNull().default(""),
    // Snapshot of the linked Discord account when the athlete last saved.
    discordUserId: text("discord_user_id"),
    discordUsername: text("discord_username"),
    // Shown to the athlete; required when rejecting.
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    // Bumped by every write, so an edit based on an old read is refused.
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("sport_registration_user_division_uidx").on(table.userId, table.divisionId),
    // One shirt number per team: a team is a division's athletes from one institution.
    uniqueIndex("sport_registration_shirt_uidx")
      .on(table.divisionId, table.institution, table.shirtNumber)
      .where(sql`shirt_number IS NOT NULL AND ${notRejected}`),
    uniqueIndex("sport_registration_rank_uidx")
      .on(table.divisionId, table.institution, table.badmintonRank)
      .where(sql`badminton_rank IS NOT NULL AND ${notRejected}`),
    index("sport_registration_division_idx").on(table.divisionId, table.institution),
    index("sport_registration_institution_idx").on(table.institution, table.status),
    check("sport_registration_status_check", sql`${table.status} IN (${inList(REGISTRATION_STATUSES)})`),
    check(
      "sport_registration_rank_check",
      sql`${table.badmintonRank} IS NULL OR ${table.badmintonRank} IN (1, 2)`,
    ),
    check(
      "sport_registration_shirt_check",
      sql`${table.shirtNumber} IS NULL OR ${table.shirtNumber} BETWEEN 0 AND 99`,
    ),
  ],
);

// Append-only change log: who changed what, from what, to what. No foreign
// keys, so the history outlives the accounts and registrations it names.
export const sportRegistrationChange = sqliteTable(
  "sport_registration_change",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    registrationId: text("registration_id").notNull(),
    athleteUserId: text("athlete_user_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    // The admin behind an impersonated session, if any.
    impersonatedBy: text("impersonated_by"),
    action: text("action", { enum: REGISTRATION_CHANGE_ACTIONS }).notNull(),
    // `{ field: [before, after] }`
    changes: text("changes", { mode: "json" })
      .$type<Record<string, [unknown, unknown]>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("sport_registration_change_registration_idx").on(table.registrationId, table.createdAt),
  ],
);
