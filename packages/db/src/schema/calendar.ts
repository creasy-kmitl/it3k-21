import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { department } from "./department";

/** The four views of one dataset: every item belongs to exactly one mode. */
export const CALENDAR_MODES = ["operations", "coordination", "delivery", "meetings"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export const CALENDAR_CATEGORIES = [
  "match",
  "broadcast",
  "result_update",
  "technical_check",
  "rehearsal",
  "cross_team_meeting",
  "handoff",
  "approval",
  "information_request",
  "planning",
  "design",
  "development",
  "code_review",
  "qa",
  "release",
  "monitoring",
  "incident",
  "post_event_review",
] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

/** Which categories each mode accepts, so matches, meetings and releases never mix. */
export const CATEGORIES_BY_MODE: Record<CalendarMode, readonly CalendarCategory[]> = {
  operations: ["match", "broadcast", "result_update", "technical_check", "rehearsal", "incident"],
  coordination: ["cross_team_meeting", "handoff", "approval", "information_request"],
  delivery: [
    "planning",
    "design",
    "development",
    "code_review",
    "qa",
    "release",
    "monitoring",
    "incident",
  ],
  meetings: ["planning", "rehearsal", "cross_team_meeting", "post_event_review", "incident"],
};

export const OPERATIONAL_STATUSES = [
  "draft",
  "confirmed",
  "ready",
  "live",
  "completed",
  "delayed",
  "cancelled",
] as const;
export const DELIVERY_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "in_review",
  "qa",
  "ready_to_release",
  "released",
  "rolled_back",
] as const;
export const CALENDAR_STATUSES = [...OPERATIONAL_STATUSES, ...DELIVERY_STATUSES] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

/** Delivery work moves through a release pipeline; everything else is scheduled. */
export function statusesFor(mode: CalendarMode): readonly CalendarStatus[] {
  return mode === "delivery" ? DELIVERY_STATUSES : OPERATIONAL_STATUSES;
}

export const GAMES = ["tft", "valorant", "rov"] as const;
export type Game = (typeof GAMES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CALENDAR_VISIBILITIES = ["internal", "public"] as const;
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number];

export const CALENDAR_TIMEZONE = "Asia/Bangkok";

export const CALENDAR_CHANGE_ACTIONS = [
  "create",
  "update",
  "reschedule",
  "status",
  "cancel",
  "archive",
  "unarchive",
  "duplicate",
  "confirm",
  "publish",
] as const;
export type CalendarChangeAction = (typeof CALENDAR_CHANGE_ACTIONS)[number];

/**
 * Unconfirmed data is shown as TBD and must never be treated as final: a
 * draft, or anything nobody has confirmed yet.
 */
export function isTbd(item: { status: CalendarStatus; lastConfirmedAt: Date | null }) {
  return item.status === "draft" || item.lastConfirmedAt === null;
}

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

export const calendarItem = sqliteTable(
  "calendar_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    mode: text("mode", { enum: CALENDAR_MODES }).notNull(),
    category: text("category", { enum: CALENDAR_CATEGORIES }).notNull(),
    status: text("status", { enum: CALENDAR_STATUSES }).notNull(),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp_ms" }).notNull(),
    // Every time is shown in Bangkok time; stored so each record says so.
    timezone: text("timezone").default(CALENDAR_TIMEZONE).notNull(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    // Who or what the data came from, e.g. "Sports schedule v3".
    source: text("source").notNull(),
    lastConfirmedAt: integer("last_confirmed_at", { mode: "timestamp_ms" }),
    lastConfirmedById: text("last_confirmed_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility", { enum: CALENDAR_VISIBILITIES }).default("internal").notNull(),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    approvedById: text("approved_by_id").references(() => user.id, { onDelete: "set null" }),
    riskLevel: text("risk_level", { enum: RISK_LEVELS }),
    // Set while something outside the team holds the item up.
    blockedReason: text("blocked_reason"),
    // Internal only: never part of a public view.
    notes: text("notes"),
    // Context that only some categories use.
    game: text("game", { enum: GAMES }),
    matchId: text("match_id"),
    teams: text("teams", { mode: "json" }).$type<string[]>(),
    venue: text("venue"),
    streamPlatform: text("stream_platform"),
    scoreboardUrl: text("scoreboard_url"),
    meetingLink: text("meeting_link"),
    agenda: text("agenda"),
    feature: text("feature"),
    environment: text("environment"),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
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
    index("calendar_item_mode_idx").on(table.mode),
    check("calendar_item_mode_check", sql`${table.mode} IN (${inList(CALENDAR_MODES)})`),
    check(
      "calendar_item_category_check",
      sql`${table.category} IN (${inList(CALENDAR_CATEGORIES)})`,
    ),
    check("calendar_item_status_check", sql`${table.status} IN (${inList(CALENDAR_STATUSES)})`),
    check(
      "calendar_item_visibility_check",
      sql`${table.visibility} IN (${inList(CALENDAR_VISIBILITIES)})`,
    ),
    check(
      "calendar_item_risk_level_check",
      sql`${table.riskLevel} IS NULL OR ${table.riskLevel} IN (${inList(RISK_LEVELS)})`,
    ),
    check(
      "calendar_item_game_check",
      sql`${table.game} IS NULL OR ${table.game} IN (${inList(GAMES)})`,
    ),
    check("calendar_item_time_check", sql`${table.endAt} > ${table.startAt}`),
  ],
);

/** The departments an item involves or depends on. */
export const calendarItemDepartment = sqliteTable(
  "calendar_item_department",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    itemId: text("item_id")
      .notNull()
      .references(() => calendarItem.id, { onDelete: "cascade" }),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("calendar_item_department_uidx").on(table.itemId, table.departmentId),
    index("calendar_item_department_department_id_idx").on(table.departmentId),
  ],
);

// Append-only change log: who changed what, from what, to what, and why.
// Deliberately no foreign keys, so the history outlives the accounts it names.
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
