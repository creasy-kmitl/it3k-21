import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { EVENT_TYPES } from "../event-rules";
import type { Institution } from "../profile";
import { user } from "./auth";
import { sportDivision } from "./sport";

export * from "../event-rules";

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

/** A place events happen, picked from a searchable list. */
export const venue = sqliteTable(
  "venue",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    // Both or neither, for a map pin.
    latitude: real("latitude"),
    longitude: real("longitude"),
    // A map or directions link.
    externalUrl: text("external_url"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("venue_name_uidx").on(table.name),
    check(
      "venue_position_check",
      sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL) AND (${table.latitude} IS NULL OR ${table.latitude} BETWEEN -90 AND 90) AND (${table.longitude} IS NULL OR ${table.longitude} BETWEEN -180 AND 180)`,
    ),
  ],
);

/**
 * A sport event (for some institutions and sport divisions) or a general
 * one. Check-ins come with the kiosk.
 */
export const event = sqliteTable(
  "event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp_ms" }).notNull(),
    // No ON DELETE: a venue with events cannot be deleted.
    venueId: text("venue_id").references(() => venue.id),
    // Null shows a generated illustration.
    thumbnailUrl: text("thumbnail_url"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    // Bumped by every write, so an edit based on an old read is refused.
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    index("event_start_at_idx").on(table.startAt),
    index("event_venue_id_idx").on(table.venueId),
    check("event_type_check", sql`${table.type} IN (${inList(EVENT_TYPES)})`),
    check("event_time_check", sql`${table.endAt} > ${table.startAt}`),
  ],
);

/** The institutions a sport event is for. */
export const eventInstitution = sqliteTable(
  "event_institution",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    institution: text("institution").$type<Institution>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.institution] })],
);

/** The sport divisions a sport event is for. */
export const eventDivision = sqliteTable(
  "event_division",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    // No ON DELETE: a division an event uses cannot be deleted.
    divisionId: text("division_id")
      .notNull()
      .references(() => sportDivision.id),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.divisionId] }),
    index("event_division_division_id_idx").on(table.divisionId),
  ],
);
