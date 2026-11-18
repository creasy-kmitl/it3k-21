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

import { CHECKIN_METHODS, EVENT_TYPES, type TicketRole } from "../event-rules";
import type { Institution } from "../profile";
import type { RichTextDoc } from "../rich-text";
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
 * one.
 */
export const event = sqliteTable(
  "event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    name: text("name").notNull(),
    // The event's address in links, e.g. `/kiosk/<slug>`; the id works too.
    // Null for events made before slugs, until they are next saved.
    slug: text("slug"),
    // A plain-text summary of `content` for cards and link previews, written
    // by the API on every save. Events from before rich text have only this.
    description: text("description"),
    // The event page's body as a Tiptap document (`richTextDocSchema`).
    content: text("content", { mode: "json" }).$type<RichTextDoc>(),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp_ms" }).notNull(),
    // No ON DELETE: a venue with events cannot be deleted.
    venueId: text("venue_id").references(() => venue.id),
    // Null shows a generated illustration.
    thumbnailUrl: text("thumbnail_url"),
    // Whether accounts may claim tickets now, of any type; claiming also
    // stops at endAt. Each ticket type has its own switch as well.
    ticketsOpen: integer("tickets_open", { mode: "boolean" }).notNull().default(false),
    // Most tickets the event hands out across all its types; null for no
    // limit. Kept positive by
    // `eventInput`, not a CHECK: adding one would rebuild the table, and on D1
    // that cascades deletes into check-ins.
    ticketCapacity: integer("ticket_capacity"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    // Bumped by every write, so an edit based on an old read is refused.
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    // SQLite lets any number of rows share a null slug.
    uniqueIndex("event_slug_uidx").on(table.slug),
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

/** One account checked in at one event, by the kiosk or by hand. */
export const eventCheckin = sqliteTable(
  "event_checkin",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The ticket this check-in used; null for one forced in without a ticket.
    // Each ticket checks in once, so someone holding two tickets checks in
    // twice.
    ticketId: text("ticket_id").references(() => eventTicket.id, { onDelete: "cascade" }),
    checkedInBy: text("checked_in_by").references(() => user.id, { onDelete: "set null" }),
    method: text("method", { enum: CHECKIN_METHODS }).notNull(),
    // Checked in without a ticket, by a catalog manager.
    forced: integer("forced", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("event_checkin_ticket_uidx").on(table.ticketId),
    // At most one ticketless check-in per person and event.
    uniqueIndex("event_checkin_ticketless_uidx")
      .on(table.eventId, table.userId)
      .where(sql`${table.ticketId} IS NULL`),
    index("event_checkin_event_user_idx").on(table.eventId, table.userId),
    index("event_checkin_user_id_idx").on(table.userId),
    check("event_checkin_method_check", sql`${table.method} IN (${inList(CHECKIN_METHODS)})`),
  ],
);

/**
 * A kind of ticket an event hands out, with its own seats, per-person limit
 * and rules on who may claim it. Empty rule lists allow anyone; when several
 * kinds of rule are set, a claimer must pass each kind.
 */
export const eventTicketType = sqliteTable(
  "event_ticket_type",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Null for no limit.
    capacity: integer("capacity"),
    maxPerUser: integer("max_per_user").notNull().default(1),
    open: integer("open", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    // Only athletes the (sport) event expects: approved, in its divisions
    // and institutions.
    listedOnly: integer("listed_only", { mode: "boolean" }).notNull().default(false),
    allowedRoles: text("allowed_roles", { mode: "json" })
      .$type<TicketRole[]>()
      .notNull()
      .default(sql`'[]'`),
    allowedInstitutions: text("allowed_institutions", { mode: "json" })
      .$type<Institution[]>()
      .notNull()
      .default(sql`'[]'`),
    // Athletes with an approved registration in any division of these sports.
    allowedSportIds: text("allowed_sport_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    ...timestamps(),
  },
  (table) => [index("event_ticket_type_event_id_idx").on(table.eventId)],
);

/**
 * One ticket to one event, claimed by its holder. The QR it shows holds
 * `code`; cancelling a ticket deletes the row. A ticket type may let one
 * account hold several.
 */
export const eventTicket = sqliteTable(
  "event_ticket",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Null only in the database, for tickets older than ticket types until
    // the backfill migration; the API always sets it. No ON DELETE: a type
    // with tickets cannot be deleted.
    ticketTypeId: text("ticket_type_id").references(() => eventTicketType.id),
    // Random and unguessable; what the kiosk looks a ticket up by.
    code: text("code").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("event_ticket_code_uidx").on(table.code),
    index("event_ticket_event_user_idx").on(table.eventId, table.userId),
    index("event_ticket_type_user_idx").on(table.ticketTypeId, table.userId),
    index("event_ticket_user_id_idx").on(table.userId),
  ],
);
