import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import {
  ACTION_ITEM_STATUSES,
  CALENDAR_CATEGORIES,
  CALENDAR_CHANGE_ACTIONS,
  CALENDAR_MODES,
  CALENDAR_STATUSES,
  CALENDAR_TIMEZONE,
  CALENDAR_VISIBILITIES,
  GAMES,
  LIVE_CHECKLIST,
  NOTIFICATION_KINDS,
  QA_RESULTS,
  REQUEST_STATES,
  RISK_LEVELS,
} from "../calendar-rules";
import { user } from "./auth";
import { department } from "./department";

export * from "../calendar-rules";

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
    // Who answers when a live block goes wrong.
    onCallOwnerId: text("on_call_owner_id").references(() => user.id, { onDelete: "set null" }),
    scoreboardOperatorId: text("scoreboard_operator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // How a clash the editor accepted will be handled.
    mitigation: text("mitigation"),
    // Delivery: links, and for releases the plan and the gates before release.
    specUrl: text("spec_url"),
    designUrl: text("design_url"),
    pullRequestUrl: text("pull_request_url"),
    qaUrl: text("qa_url"),
    incidentUrl: text("incident_url"),
    qaResult: text("qa_result", { enum: QA_RESULTS }),
    rolloutPlan: text("rollout_plan"),
    rollbackPlan: text("rollback_plan"),
    monitoringOwnerId: text("monitoring_owner_id").references(() => user.id, {
      onDelete: "set null",
    }),
    releaseApprovedAt: integer("release_approved_at", { mode: "timestamp_ms" }),
    releaseApprovedById: text("release_approved_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    meetingLink: text("meeting_link"),
    agenda: text("agenda"),
    feature: text("feature"),
    environment: text("environment"),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    // Shared by the items of one recurring ritual, e.g. a weekly sync.
    seriesId: text("series_id"),
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
    index("calendar_item_series_id_idx").on(table.seriesId, table.startAt),
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
    check(
      "calendar_item_qa_result_check",
      sql`${table.qaResult} IS NULL OR ${table.qaResult} IN (${inList(QA_RESULTS)})`,
    ),
  ],
);

/**
 * The departments an item involves or depends on, and what each one owes:
 * Tech/Live states the request, the department answers it.
 */
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
    state: text("state", { enum: REQUEST_STATES }).default("involved").notNull(),
    // What Tech/Live needs from the department.
    request: text("request"),
    // Who in the department is expected to answer.
    contactUserId: text("contact_user_id").references(() => user.id, { onDelete: "set null" }),
    dueAt: integer("due_at", { mode: "timestamp_ms" }),
    response: text("response"),
    answeredAt: integer("answered_at", { mode: "timestamp_ms" }),
    answeredById: text("answered_by_id").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("calendar_item_department_uidx").on(table.itemId, table.departmentId),
    index("calendar_item_department_department_id_idx").on(table.departmentId),
    check(
      "calendar_item_department_state_check",
      sql`${table.state} IN (${inList(REQUEST_STATES)})`,
    ),
  ],
);

/** Follow-ups from a meeting or handoff, linked back to where they came from. */
export const calendarActionItem = sqliteTable(
  "calendar_action_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    itemId: text("item_id")
      .notNull()
      .references(() => calendarItem.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    departmentId: text("department_id").references(() => department.id, {
      onDelete: "set null",
    }),
    dueAt: integer("due_at", { mode: "timestamp_ms" }),
    status: text("status", { enum: ACTION_ITEM_STATUSES }).default("open").notNull(),
    doneAt: integer("done_at", { mode: "timestamp_ms" }),
    doneById: text("done_by_id").references(() => user.id, { onDelete: "set null" }),
    version: integer("version").default(1).notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("calendar_action_item_item_id_idx").on(table.itemId),
    index("calendar_action_item_owner_id_idx").on(table.ownerId, table.status),
    index("calendar_action_item_department_id_idx").on(table.departmentId, table.status),
    check(
      "calendar_action_item_status_check",
      sql`${table.status} IN (${inList(ACTION_ITEM_STATUSES)})`,
    ),
  ],
);

/** A live item's readiness checklist; a missing row means not checked yet. */
export const calendarChecklistItem = sqliteTable(
  "calendar_checklist_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    itemId: text("item_id")
      .notNull()
      .references(() => calendarItem.id, { onDelete: "cascade" }),
    key: text("key", { enum: LIVE_CHECKLIST }).notNull(),
    checked: integer("checked", { mode: "boolean" }).default(false).notNull(),
    note: text("note"),
    checkedAt: integer("checked_at", { mode: "timestamp_ms" }),
    checkedById: text("checked_by_id").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("calendar_checklist_item_uidx").on(table.itemId, table.key),
    check("calendar_checklist_item_key_check", sql`${table.key} IN (${inList(LIVE_CHECKLIST)})`),
  ],
);

/** `itemId` cannot finish until `dependsOnId` is completed or released. */
export const calendarDependency = sqliteTable(
  "calendar_dependency",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    itemId: text("item_id")
      .notNull()
      .references(() => calendarItem.id, { onDelete: "cascade" }),
    dependsOnId: text("depends_on_id")
      .notNull()
      .references(() => calendarItem.id, { onDelete: "cascade" }),
    // What slips if the upstream item is late, e.g. "stream slot 18:00".
    impact: text("impact"),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("calendar_dependency_uidx").on(table.itemId, table.dependsOnId),
    index("calendar_dependency_depends_on_id_idx").on(table.dependsOnId),
    check("calendar_dependency_self_check", sql`${table.itemId} <> ${table.dependsOnId}`),
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

/** What a meeting decided. */
export const calendarDecision = sqliteTable(
  "calendar_decision",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    itemId: text("item_id")
      .notNull()
      .references(() => calendarItem.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [index("calendar_decision_item_id_idx").on(table.itemId, table.createdAt)],
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
