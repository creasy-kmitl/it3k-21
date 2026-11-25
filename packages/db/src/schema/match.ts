import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import {
  ANNOUNCE_MODES,
  MATCH_STATUSES,
  type MatchBreak,
  type MatchSet,
  SCORING_MODES,
  UNIVERSITIES,
  type University,
} from "../match-rules";
import { user } from "./auth";

export * from "../match-rules";

/**
 * One game between two universities and its score. Staff record and correct
 * scores; everyone sees them on the public scoreboard. `version` goes up on
 * every write, so an edit based on an old read is refused.
 */
export const match = sqliteTable(
  "match",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sport: text("sport").notNull(),
    /** The sport's division this game belongs to, by name, e.g. "บาสเกตบอล ทีมชาย (5x5)". */
    division: text("division"),
    round: text("round"),
    /** The two sides; empty when the result is announced as a ranking. */
    teamA: text("team_a", { enum: UNIVERSITIES }),
    teamB: text("team_b", { enum: UNIVERSITIES }),
    /** Live score, or only the final ranking once the match is over. */
    announce: text("announce", { enum: ANNOUNCE_MODES }).default("live").notNull(),
    /** Universities from 1st place down, set after a match announced as a ranking. */
    ranking: text("ranking", { mode: "json" }).$type<University[]>(),
    /** How the match is reported: a running score, set by set, or only who won afterwards. */
    scoring: text("scoring", { enum: SCORING_MODES }).default("points").notNull(),
    /** For a series of sets: how many sets a side needs to win it. */
    setsToWin: integer("sets_to_win"),
    /** Each set's points; the scores below are then the sets won. */
    sets: text("sets", { mode: "json" }).$type<MatchSet[]>(),
    /** The side that won a pair match reported after it ends. */
    winner: text("winner", { enum: UNIVERSITIES }),
    scoreA: integer("score_a"),
    scoreB: integer("score_b"),
    status: text("status", { enum: MATCH_STATUSES }).default("scheduled").notNull(),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
    /** Minutes of play, breaks not included. */
    durationMinutes: integer("duration_minutes"),
    /** Pauses in play, e.g. [{ atMinute: 60, minutes: 15 }]. */
    breaks: text("breaks", { mode: "json" }).$type<MatchBreak[]>(),
    /** Set while play is stopped for an emergency; the match is still live. */
    pausedAt: integer("paused_at", { mode: "timestamp_ms" }),
    /** Milliseconds of emergency stops already over, which push the finish back. */
    pausedMs: integer("paused_ms").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    updatedById: text("updated_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("match_sport_idx").on(table.sport),
    index("match_starts_at_idx").on(table.startsAt),
  ],
);
