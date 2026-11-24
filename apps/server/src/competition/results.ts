// Writes a match's worked-out state into the cached columns that public pages
// and standings read, so they never replay score events. Scoring and check-in
// (forfeits) both write results through here; put the statements in the same
// batch as the change that produced them.
import type { Database } from "@it3k/db";
import type { MatchOutcome, MatchState, MatchStatus } from "@it3k/db/competition-rules";
import { competitionMatch, competitionMatchParticipant } from "@it3k/db/schema/index";
import { and, eq, sql } from "drizzle-orm";

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
      liveState: {
        period: state.period,
        phase: state.phase,
        decided: state.decided,
        clock: state.clock,
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
  return [match, ...sides] as const;
}
