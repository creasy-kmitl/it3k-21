import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { MATCH_STATUSES, UNIVERSITIES } from "../match-rules";
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
    round: text("round"),
    teamA: text("team_a", { enum: UNIVERSITIES }).notNull(),
    teamB: text("team_b", { enum: UNIVERSITIES }).notNull(),
    scoreA: integer("score_a"),
    scoreB: integer("score_b"),
    status: text("status", { enum: MATCH_STATUSES }).default("scheduled").notNull(),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
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
