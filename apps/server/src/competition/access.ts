// Reading a match the way every competition route needs it: with its division's
// settings and its sides, plus the SQL that rechecks what was read inside a
// write batch (abortUnless).
import type { Database } from "@it3k/db";
import { resolveScoringConfig } from "@it3k/db/scoring/presets";
import {
  competitionMatch,
  competitionMatchParticipant,
  sportDivision,
} from "@it3k/db/schema/index";
import { type SQL, and, asc, eq, sql } from "drizzle-orm";

export type LoadedMatch = NonNullable<Awaited<ReturnType<typeof loadMatch>>>;

/** A match with its division and sides in slot order; null when there is none. */
export async function loadMatch(db: Database, matchId: string) {
  const [row] = await db
    .select({
      match: competitionMatch,
      division: {
        id: sportDivision.id,
        code: sportDivision.code,
        name: sportDivision.name,
        sportId: sportDivision.sportId,
        format: sportDivision.format,
        scoringConfig: sportDivision.scoringConfig,
        lineupStarters: sportDivision.lineupStarters,
        lineupMaxSubs: sportDivision.lineupMaxSubs,
        checkinMode: sportDivision.checkinMode,
        checkinOpensMin: sportDivision.checkinOpensMin,
        checkinClosesMin: sportDivision.checkinClosesMin,
        checkinMinPlayers: sportDivision.checkinMinPlayers,
        teamMinSize: sportDivision.teamMinSize,
      },
    })
    .from(competitionMatch)
    .innerJoin(sportDivision, eq(sportDivision.id, competitionMatch.divisionId))
    .where(eq(competitionMatch.id, matchId));
  if (!row) return null;
  const participants = await db
    .select()
    .from(competitionMatchParticipant)
    .where(eq(competitionMatchParticipant.matchId, matchId))
    .orderBy(asc(competitionMatchParticipant.slot));
  return {
    ...row.match,
    division: row.division,
    participants,
    scoring: resolveScoringConfig(row.match, row.division),
  };
}

/** SQL: the match is still at the version the route read. */
export function matchAsRead(matchId: string, version: number): SQL {
  return sql`exists (select 1 from ${competitionMatch} where ${and(
    eq(competitionMatch.id, matchId),
    eq(competitionMatch.version, version),
  )})`;
}

/** SQL: no score event was added to the match since the route read `scoreSeq`. */
export function scoreSeqAsRead(matchId: string, scoreSeq: number): SQL {
  return sql`exists (select 1 from ${competitionMatch} where ${and(
    eq(competitionMatch.id, matchId),
    eq(competitionMatch.scoreSeq, scoreSeq),
  )})`;
}
