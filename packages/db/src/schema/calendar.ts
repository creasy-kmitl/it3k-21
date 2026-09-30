import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import {
  CALENDAR_CHANGE_ACTIONS,
  CALENDAR_STATUSES,
  CALENDAR_TIMEZONE,
  CALENDAR_VISIBILITIES,
  NOTIFICATION_KINDS,
} from "../calendar-rules";
import { user } from "./auth";
import { department } from "./department";

export * from "../calendar-rules";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

/** One entry on a department's calendar. */
export const calendarItem = sqliteTable(
  "calendar_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", { enum: CALENDAR_STATUSES }).notNull(),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp_ms" }).notNull(),
    // Every time is shown in Bangkok time; stored so each record says so.
    timezone: text("timezone").default(CALENDAR_TIMEZONE).notNull(),
    venue: text("venue"),
    // Internal only: never part of a public view.
    notes: text("notes"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    visibility: text("visibility", { enum: CALENDAR_VISIBILITIES }).default("internal").notNull(),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    approvedById: text("approved_by_id").references(() => user.id, { onDelete: "set null" }),
    // Bumped by every write, so an edit based on an old read is refused.
    version: integer("version").default(1).notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("calendar_item_start_at_idx").on(table.startAt),
    index("calendar_item_end_at_idx").on(table.endAt),
    index("calendar_item_owner_id_idx").on(table.ownerId),
    index("calendar_item_department_id_idx").on(table.departmentId, table.startAt),
    check("calendar_item_status_check", sql`${table.status} IN (${inList(CALENDAR_STATUSES)})`),
    check(
      "calendar_item_visibility_check",
      sql`${table.visibility} IN (${inList(CALENDAR_VISIBILITIES)})`,
    ),
    check("calendar_item_time_check", sql`${table.endAt} > ${table.startAt}`),
  ],
);

/**
 * In-app notifications, written in the same batch as the change that causes
 * them. `data` holds what the web app needs to word the message.
 */
export const calendarNotification = sqliteTable(
  "calendar_notification",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => calendarItem.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: NOTIFICATION_KINDS }).notNull(),
    // The item's title when this was sent.
    itemTitle: text("item_title").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    actorUserId: text("actor_user_id"),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("calendar_notification_user_id_idx").on(table.userId, table.createdAt),
    check(
      "calendar_notification_kind_check",
      sql`${table.kind} IN (${inList(NOTIFICATION_KINDS)})`,
    ),
  ],
);

// Append-only change log: who changed what, from what, to what, and why.
// Deliberately no foreign keys, so the history outlives the accounts and
// items it names.
export const calendarChange = sqliteTable(
  "calendar_change",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    itemId: text("item_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    // The admin behind an impersonated session, if any.
    impersonatedBy: text("impersonated_by"),
    action: text("action", { enum: CALENDAR_CHANGE_ACTIONS }).notNull(),
    // `{ field: [before, after] }`
    changes: text("changes", { mode: "json" })
      .$type<Record<string, [unknown, unknown]>>()
      .notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [index("calendar_change_item_id_idx").on(table.itemId, table.createdAt)],
);
