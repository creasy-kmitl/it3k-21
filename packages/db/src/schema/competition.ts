// Competitions: teams, groups, matches, lineups, match check-in and scores.
//
// Statuses, outcomes and score event types are checked by competition-rules.ts,
// not by CHECK constraints. Adding a CHECK to a parent table here rebuilds it,
// and on D1 the rebuild cascades into every row that points at it (score logs,
// check-ins), so only constraints that can never change are in SQL.
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  CheckinMethod,
  LineupRole,
  MatchOutcome,
  MatchStatus,
  ParticipantDetail,
  ParticipantOutcome,
  ScoreEventPayload,
  ScoreEventType,
  ScoringConfig,
  SideSource,
} from "../competition-rules";
import type { Institution } from "../profile";
import { user } from "./auth";
import { venue } from "./event";
import { sportDivision, sportRegistration } from "./sport";

const timestamps = () => ({
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** One institution's team in one division. Badminton singles allow two (มือ 1, มือ 2). */
export const competitionTeam = sqliteTable(
  "competition_team",
  {
    id: id(),
    // No ON DELETE: a division with teams cannot be deleted.
    divisionId: text("division_id")
      .notNull()
      .references(() => sportDivision.id),
    institution: text("institution").$type<Institution>().notNull(),
    // The team's number within its institution; badminton rank n plays as team n.
    seq: integer("seq").notNull().default(1),
    // Null shows the institution's short name, with the number when there are several.
    name: text("name"),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("competition_team_slot_uidx").on(table.divisionId, table.institution, table.seq),
    index("competition_team_institution_idx").on(table.institution),
    check("competition_team_seq_check", sql`${table.seq} >= 1`),
  ],
);

/** An approved registration playing for a team; one team per athlete per division. */
export const competitionTeamMember = sqliteTable(
  "competition_team_member",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => competitionTeam.id, { onDelete: "cascade" }),
    registrationId: text("registration_id")
      .notNull()
      .references(() => sportRegistration.id, { onDelete: "cascade" }),
    // Copied from the registration so the kiosk finds a scanned account fast.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The athlete's first name as public pages show it, copied when they join.
    displayName: text("display_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.registrationId] }),
    uniqueIndex("competition_team_member_registration_uidx").on(table.registrationId),
    index("competition_team_member_user_idx").on(table.userId),
  ],
);

/** A coach or manager: a name and a picture, not an account. */
export const competitionTeamOfficial = sqliteTable(
  "competition_team_official",
  {
    id: id(),
    teamId: text("team_id")
      .notNull()
      .references(() => competitionTeam.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: text("position"),
    description: text("description"),
    photoUrl: text("photo_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (table) => [index("competition_team_official_team_idx").on(table.teamId)],
);

/** A group (สาย) of a stage, e.g. รอบแบ่งกลุ่ม สาย A. */
export const competitionGroup = sqliteTable(
  "competition_group",
  {
    id: id(),
    divisionId: text("division_id")
      .notNull()
      .references(() => sportDivision.id),
    stageName: text("stage_name").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("competition_group_name_uidx").on(table.divisionId, table.stageName, table.name),
  ],
);

export const competitionGroupTeam = sqliteTable(
  "competition_group_team",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => competitionGroup.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => competitionTeam.id, { onDelete: "cascade" }),
    seed: integer("seed"),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.teamId] }),
    index("competition_group_team_team_idx").on(table.teamId),
  ],
);

/**
 * A match between two or more sides. A sub-match (a table tennis team rubber)
 * points at its parent and is numbered within it.
 */
export const competitionMatch = sqliteTable(
  "competition_match",
  {
    id: id(),
    divisionId: text("division_id")
      .notNull()
      .references(() => sportDivision.id),
    parentMatchId: text("parent_match_id").references((): AnySQLiteColumn => competitionMatch.id, {
      onDelete: "cascade",
    }),
    subOrder: integer("sub_order"),
    // No ON DELETE: a group with matches cannot be deleted.
    groupId: text("group_id").references(() => competitionGroup.id),
    stageName: text("stage_name").notNull(),
    roundNo: integer("round_no"),
    matchNo: integer("match_no"),
    startAt: integer("start_at", { mode: "timestamp_ms" }),
    venueId: text("venue_id").references(() => venue.id, { onDelete: "set null" }),
    court: text("court"),
    status: text("status").$type<MatchStatus>().notNull().default("scheduled"),
    outcome: text("outcome").$type<MatchOutcome>(),
    // A friendly earns no standings points or medals.
    friendly: integer("friendly", { mode: "boolean" }).notNull().default(false),
    // This round's own scoring settings; null uses the division's.
    scoringConfig: text("scoring_config", { mode: "json" }).$type<ScoringConfig>(),
    // The period, phase and clock as the engine last worked them out.
    liveState: text("live_state", { mode: "json" }).$type<Record<string, unknown>>(),
    // The seq of the last score event; a write based on an older one is stale.
    scoreSeq: integer("score_seq").notNull().default(0),
    coverImageUrl: text("cover_image_url"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index("competition_match_division_start_idx").on(table.divisionId, table.startAt),
    index("competition_match_status_start_idx").on(table.status, table.startAt),
    index("competition_match_venue_start_idx").on(table.venueId, table.startAt),
    index("competition_match_group_idx").on(table.groupId),
    uniqueIndex("competition_match_sub_uidx")
      .on(table.parentMatchId, table.subOrder)
      .where(sql`${table.parentMatchId} IS NOT NULL`),
    check(
      "competition_match_sub_check",
      sql`(${table.parentMatchId} IS NULL) = (${table.subOrder} IS NULL)`,
    ),
  ],
);

/** A side in a match, with its result as the engine last worked it out. */
export const competitionMatchParticipant = sqliteTable(
  "competition_match_participant",
  {
    id: id(),
    matchId: text("match_id")
      .notNull()
      .references(() => competitionMatch.id, { onDelete: "cascade" }),
    // No ON DELETE: a team that has played cannot be deleted. Null until known.
    teamId: text("team_id").references(() => competitionTeam.id),
    label: text("label"),
    // A knockout side filled by another match's winner or loser: the bracket
    // draws a line from it, and the team moves in when that match ends. The
    // label keeps "ผู้ชนะ M3" as history if the source match is deleted.
    sourceMatchId: text("source_match_id").references((): AnySQLiteColumn => competitionMatch.id, {
      onDelete: "set null",
    }),
    sourceResult: text("source_result").$type<SideSource>(),
    slot: integer("slot").notNull(),
    score: integer("score"),
    detail: text("detail", { mode: "json" }).$type<ParticipantDetail>(),
    // A race time in ms or a distance in mm.
    resultValue: integer("result_value"),
    rank: integer("rank"),
    outcome: text("outcome").$type<ParticipantOutcome>(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("competition_participant_slot_uidx").on(table.matchId, table.slot),
    uniqueIndex("competition_participant_team_uidx")
      .on(table.matchId, table.teamId)
      .where(sql`${table.teamId} IS NOT NULL`),
    index("competition_participant_team_idx").on(table.teamId),
    index("competition_participant_source_idx").on(table.sourceMatchId),
    check(
      "competition_participant_side_check",
      sql`${table.teamId} IS NOT NULL OR ${table.label} IS NOT NULL`,
    ),
  ],
);

/** Who starts and who is on the bench for one match. */
export const competitionLineup = sqliteTable(
  "competition_lineup",
  {
    participantId: text("participant_id")
      .notNull()
      .references(() => competitionMatchParticipant.id, { onDelete: "cascade" }),
    matchId: text("match_id")
      .notNull()
      .references(() => competitionMatch.id, { onDelete: "cascade" }),
    registrationId: text("registration_id")
      .notNull()
      .references(() => sportRegistration.id, { onDelete: "cascade" }),
    role: text("role").$type<LineupRole>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.participantId, table.registrationId] }),
    index("competition_lineup_match_idx").on(table.matchId),
    check("competition_lineup_role_check", sql`${table.role} IN ('starter', 'sub')`),
  ],
);

/** An athlete reporting in for a match, at the venue kiosk or ticked by staff. */
export const competitionMatchCheckin = sqliteTable(
  "competition_match_checkin",
  {
    id: id(),
    matchId: text("match_id")
      .notNull()
      .references(() => competitionMatch.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => competitionMatchParticipant.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    method: text("method").$type<CheckinMethod>().notNull(),
    checkedInBy: text("checked_in_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("competition_checkin_user_uidx").on(table.matchId, table.userId),
    index("competition_checkin_participant_idx").on(table.participantId),
    check("competition_checkin_method_check", sql`${table.method} IN ('scan', 'manual')`),
  ],
);

/**
 * Every tap of the scorer, never changed except to void it (undo). The id is
 * made on the scorer's phone, so a retried request cannot count twice.
 */
export const competitionScoreEvent = sqliteTable(
  "competition_score_event",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => competitionMatch.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").$type<ScoreEventType>().notNull(),
    participantId: text("participant_id").references(() => competitionMatchParticipant.id, {
      onDelete: "cascade",
    }),
    // No FK: the log outlives a registration that is later removed.
    registrationId: text("registration_id"),
    payload: text("payload", { mode: "json" }).$type<ScoreEventPayload>().notNull(),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    clientCreatedAt: integer("client_created_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("competition_score_event_seq_uidx").on(table.matchId, table.seq)],
);

export const competitionMatchReferee = sqliteTable(
  "competition_match_referee",
  {
    id: id(),
    matchId: text("match_id")
      .notNull()
      .references(() => competitionMatch.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (table) => [index("competition_referee_match_idx").on(table.matchId)],
);

export const competitionMatchImage = sqliteTable(
  "competition_match_image",
  {
    id: id(),
    matchId: text("match_id")
      .notNull()
      .references(() => competitionMatch.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    isCover: integer("is_cover", { mode: "boolean" }).notNull().default(false),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index("competition_image_match_idx").on(table.matchId),
    uniqueIndex("competition_image_cover_uidx")
      .on(table.matchId)
      .where(sql`${table.isCover} = 1`),
  ],
);

/** A team's final place in its division, for medals. Ties may share a place. */
export const competitionPlacement = sqliteTable(
  "competition_placement",
  {
    teamId: text("team_id")
      .primaryKey()
      .references(() => competitionTeam.id, { onDelete: "cascade" }),
    divisionId: text("division_id")
      .notNull()
      .references(() => sportDivision.id),
    place: integer("place").notNull(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index("competition_placement_division_idx").on(table.divisionId, table.place),
    check("competition_placement_place_check", sql`${table.place} >= 1`),
  ],
);

/**
 * Who changed what in a competition. Append-only, with no foreign keys, so the
 * history stays when teams, matches or accounts are deleted.
 */
export const competitionChange = sqliteTable(
  "competition_change",
  {
    id: id(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    actorUserId: text("actor_user_id"),
    impersonatedBy: text("impersonated_by"),
    action: text("action").notNull(),
    changes: text("changes", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("competition_change_entity_idx").on(table.entity, table.entityId, table.createdAt),
  ],
);
