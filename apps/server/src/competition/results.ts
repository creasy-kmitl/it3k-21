// Writes a match's worked-out state into the cached columns that public pages
// and standings read, so they never replay score events. Scoring and check-in
// (forfeits) both write results through here; put the statements in the same
// batch as the change that produced them.
import type { Database } from "@it3k/db";
import {
  type MatchOutcome,
  type MatchState,
  type MatchStatus,
  type ParticipantOutcome,
  SIDE_SOURCES,
  type SideSource,
} from "@it3k/db/competition-rules";
import {
  competitionLineup,
  competitionMatch,
  competitionMatchCheckin,
  competitionMatchParticipant,
} from "@it3k/db/schema/index";
import { and, eq, inArray, ne, notExists, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

export type ResultChange = {
  matchId: string;
  state: MatchState;
  status?: MatchStatus;
  outcome?: MatchOutcome | null;
  // Null leaves the score sequence as it is.
  scoreSeq?: number | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

/** Statements that store `state` on the match and each of its sides. */
export function resultStatements(db: Database, change: ResultChange) {
  const { matchId, state } = change;
  const sides = state.participants.map((side) =>
    db
      .update(competitionMatchParticipant)
      .set({
        score: side.score,
        detail: side.detail,
        resultValue: side.resultValue,
        rank: side.rank,
        outcome: side.outcome,
      })
      .where(
        and(
          eq(competitionMatchParticipant.id, side.participantId),
          eq(competitionMatchParticipant.matchId, matchId),
        ),
      ),
  );
  const match = db
    .update(competitionMatch)
    .set({
      // The timeline goes with it so the public match page can show who scored
      // without replaying the events; it is a few short lines per score.
      liveState: {
        period: state.period,
        phase: state.phase,
        decided: state.decided,
        clock: state.clock,
        timeline: state.timeline,
      },
      ...(change.status ? { status: change.status } : {}),
      ...(change.outcome !== undefined ? { outcome: change.outcome } : {}),
      ...(change.scoreSeq != null ? { scoreSeq: change.scoreSeq } : {}),
      ...(change.startedAt !== undefined ? { startedAt: change.startedAt } : {}),
      ...(change.finishedAt !== undefined ? { finishedAt: change.finishedAt } : {}),
      version: sql`${competitionMatch.version} + 1`,
    })
    .where(eq(competitionMatch.id, matchId));
  // The match first, so the batch type sees at least one statement.
  return [
    match,
    ...sides,
    ...(change.status === "finished" ? advanceStatements(db, matchId) : []),
  ] as const;
}

const OUTCOMES_OF: Record<SideSource, ParticipantOutcome[]> = {
  winner: ["win", "walkover_win"],
  loser: ["loss", "forfeit"],
};

const source = alias(competitionMatchParticipant, "source_side");
const other = alias(competitionMatchParticipant, "other_side");

/** SQL: matches nobody has started scoring or checking out of yet. */
function notStartedMatches(db: Database) {
  return db
    .select({ id: competitionMatch.id })
    .from(competitionMatch)
    .where(
      and(
        eq(competitionMatch.scoreSeq, 0),
        notInArray(competitionMatch.status, ["live", "finished", "cancelled"]),
      ),
    );
}

/**
 * Statements that move a finished match's winner and loser into the knockout
 * sides waiting on them. They read the outcomes written earlier in the same
 * batch, so a corrected result moves the right team. A side is left alone
 * when there is no single winner (or loser), its match has started, its team
 * already has a lineup or check-ins, or the team already plays in that match.
 */
function advanceStatements(db: Database, matchId: string) {
  const fed = db
    .select({ matchId: competitionMatchParticipant.matchId })
    .from(competitionMatchParticipant)
    .where(eq(competitionMatchParticipant.sourceMatchId, matchId));
  const moves = SIDE_SOURCES.map((result) => {
    // The one side with this outcome; null when there are none or several.
    const team = sql`(${db
      .select({ teamId: source.teamId })
      .from(source)
      .where(
        and(
          eq(source.matchId, matchId),
          inArray(source.outcome, OUTCOMES_OF[result]),
        ),
      )
      .groupBy(source.matchId)
      .having(sql`count(*) = 1`)})`;
    return db
      .update(competitionMatchParticipant)
      .set({ teamId: team })
      .where(
        and(
          eq(competitionMatchParticipant.sourceMatchId, matchId),
          eq(competitionMatchParticipant.sourceResult, result),
          sql`${team} is not null`,
          sql`${competitionMatchParticipant.teamId} is not ${team}`,
          inArray(competitionMatchParticipant.matchId, notStartedMatches(db)),
          notExists(
            db
              .select({ one: sql`1` })
              .from(competitionLineup)
              .where(eq(competitionLineup.participantId, competitionMatchParticipant.id)),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(competitionMatchCheckin)
              .where(eq(competitionMatchCheckin.participantId, competitionMatchParticipant.id)),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(other)
              .where(
                and(
                  eq(other.matchId, competitionMatchParticipant.matchId),
                  sql`${other.teamId} = ${team}`,
                  ne(other.id, competitionMatchParticipant.id),
                ),
              ),
          ),
        ),
      );
  });
  return [
    // Open edit forms on the matches fed by this one must reload.
    db
      .update(competitionMatch)
      .set({ version: sql`${competitionMatch.version} + 1` })
      .where(
        and(
          inArray(competitionMatch.id, fed),
          inArray(competitionMatch.id, notStartedMatches(db)),
        ),
      ),
    ...moves,
  ];
}
