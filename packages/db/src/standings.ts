// Group tables (สาย), worked out from the results cached on each match. Pure,
// so the public API, staff pages and the tests all get the same table.
//
// Only finished, non-friendly matches between two teams of the group count. A
// match that ended with no result (no_contest) counts for nobody.
import type {
  MatchOutcome,
  MatchStatus,
  ParticipantDetail,
  ParticipantOutcome,
  StandingsConfig,
  Tiebreak,
} from "./competition-rules";

export type StandingsSide = {
  teamId: string | null;
  score: number | null;
  detail: ParticipantDetail | null;
  outcome: ParticipantOutcome | null;
};

export type StandingsMatch = {
  status: MatchStatus;
  outcome: MatchOutcome | null;
  friendly: boolean;
  sides: StandingsSide[];
};

export type StandingsRow = {
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  // Matches lost by not turning up or being disqualified; also counted in `losses`.
  forfeits: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDiff: number;
  // Sets (or games) won and lost, from each side's `detail.won`.
  setsFor: number;
  setsAgainst: number;
  // Points inside sets, ends or periods, from each side's `detail.parts`.
  pointsFor: number;
  pointsAgainst: number;
  points: number;
  // Teams still level after every tiebreak share a rank.
  rank: number;
};

type Result = "win" | "draw" | "loss" | "forfeit";

type Game = {
  teams: [string, string];
  results: [Result, Result];
  score: [number, number];
  sets: [number, number];
  parts: [number, number];
};

const sum = (values: number[] | undefined) => (values ?? []).reduce((total, v) => total + v, 0);

function resultOf(side: StandingsSide, other: StandingsSide): Result | null {
  switch (side.outcome) {
    case "win":
    case "walkover_win":
      return "win";
    case "draw":
      return "draw";
    case "loss":
      return "loss";
    case "forfeit":
      return "forfeit";
    case null:
      break;
  }
  // No outcome cached: read it off the scores.
  if (side.score === null || other.score === null) return null;
  if (side.score > other.score) return "win";
  if (side.score < other.score) return "loss";
  return "draw";
}

/** The two-team games of the group that count, in a shape the table reads. */
function countedGames(teamIds: ReadonlySet<string>, matches: StandingsMatch[]): Game[] {
  const games: Game[] = [];
  for (const match of matches) {
    if (match.status !== "finished" || match.friendly || match.outcome === "no_contest") continue;
    if (match.sides.length !== 2) continue;
    const [a, b] = match.sides as [StandingsSide, StandingsSide];
    if (!a.teamId || !b.teamId || a.teamId === b.teamId) continue;
    if (!teamIds.has(a.teamId) || !teamIds.has(b.teamId)) continue;
    const resultA = resultOf(a, b);
    const resultB = resultOf(b, a);
    if (!resultA || !resultB) continue;
    games.push({
      teams: [a.teamId, b.teamId],
      results: [resultA, resultB],
      score: [a.score ?? 0, b.score ?? 0],
      sets: [a.detail?.won ?? 0, b.detail?.won ?? 0],
      parts: [sum(a.detail?.parts), sum(b.detail?.parts)],
    });
  }
  return games;
}

function pointsFor(result: Result, config: StandingsConfig) {
  return config[result];
}

/** For over against; no losses at all beats any ratio, and 0/0 is 0. */
function ratio(won: number, lost: number) {
  if (lost === 0) return won > 0 ? Number.POSITIVE_INFINITY : 0;
  return won / lost;
}

function emptyRow(teamId: string): StandingsRow {
  return {
    teamId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    forfeits: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    scoreDiff: 0,
    setsFor: 0,
    setsAgainst: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    points: 0,
    rank: 0,
  };
}

function tally(teamIds: string[], games: Game[], config: StandingsConfig) {
  const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
  for (const game of games) {
    for (const [i, j] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const row = rows.get(game.teams[i]);
      if (!row) continue;
      const result = game.results[i];
      row.played += 1;
      if (result === "win") row.wins += 1;
      else if (result === "draw") row.draws += 1;
      else {
        row.losses += 1;
        if (result === "forfeit") row.forfeits += 1;
      }
      row.points += pointsFor(result, config);
      row.scoreFor += game.score[i];
      row.scoreAgainst += game.score[j];
      row.setsFor += game.sets[i];
      row.setsAgainst += game.sets[j];
      row.pointsFor += game.parts[i];
      row.pointsAgainst += game.parts[j];
    }
  }
  for (const row of rows.values()) row.scoreDiff = row.scoreFor - row.scoreAgainst;
  return rows;
}

/** Each tied team's value for one tiebreak; higher is better. */
function tiebreakValues(
  tiebreak: Tiebreak,
  tied: string[],
  rows: Map<string, StandingsRow>,
  games: Game[],
  config: StandingsConfig,
): Map<string, number> {
  if (tiebreak === "headToHead") {
    // Points from the games the tied teams played among themselves.
    const among = new Set(tied);
    const mini = tally(
      tied,
      games.filter((g) => among.has(g.teams[0]) && among.has(g.teams[1])),
      config,
    );
    return new Map(tied.map((id) => [id, mini.get(id)?.points ?? 0]));
  }
  const value = (row: StandingsRow) => {
    switch (tiebreak) {
      case "scoreDiff":
        return row.scoreDiff;
      case "scoreFor":
        return row.scoreFor;
      case "wins":
        return row.wins;
      case "setRatio":
        return ratio(row.setsFor, row.setsAgainst);
      case "pointRatio":
        return ratio(row.pointsFor, row.pointsAgainst);
    }
  };
  return new Map(tied.map((id) => [id, value(rows.get(id) as StandingsRow)]));
}

/** Splits `ids` into runs of equal value, best first. */
function splitBy(ids: string[], values: Map<string, number>): string[][] {
  // Compared, not subtracted: two unbeaten ratios are both Infinity.
  const sorted = [...ids].sort((a, b) => {
    const va = values.get(a) ?? 0;
    const vb = values.get(b) ?? 0;
    return va === vb ? 0 : va > vb ? -1 : 1;
  });
  const runs: string[][] = [];
  for (const id of sorted) {
    const last = runs.at(-1);
    if (last && values.get(last[0] as string) === values.get(id)) last.push(id);
    else runs.push([id]);
  }
  return runs;
}

/**
 * Orders teams level on points by the division's tiebreaks, in order. When a
 * tiebreak separates some of them, each smaller tie starts the list again, so
 * head-to-head is read among only the teams still level. Returns runs of teams
 * that nothing separates.
 */
function breakTie(
  tied: string[],
  tiebreaks: readonly Tiebreak[],
  from: number,
  rows: Map<string, StandingsRow>,
  games: Game[],
  config: StandingsConfig,
): string[][] {
  if (tied.length < 2) return [tied];
  for (let i = from; i < tiebreaks.length; i++) {
    const runs = splitBy(tied, tiebreakValues(tiebreaks[i] as Tiebreak, tied, rows, games, config));
    if (runs.length > 1) {
      return runs.flatMap((run) => breakTie(run, tiebreaks, 0, rows, games, config));
    }
  }
  return [tied];
}

/**
 * A group's table. `teamIds` is the group's teams in seed order, which also
 * orders teams nothing separates.
 */
export function computeStandings(input: {
  teamIds: string[];
  matches: StandingsMatch[];
  config: StandingsConfig;
}): StandingsRow[] {
  const { teamIds, config } = input;
  const games = countedGames(new Set(teamIds), input.matches);
  const rows = tally(teamIds, games, config);
  const seedOrder = new Map(teamIds.map((id, index) => [id, index]));
  const byPoints = splitBy(teamIds, new Map(teamIds.map((id) => [id, rows.get(id)?.points ?? 0])));

  const table: StandingsRow[] = [];
  for (const level of byPoints) {
    for (const run of breakTie(level, config.tiebreaks, 0, rows, games, config)) {
      const rank = table.length + 1;
      const inSeedOrder = [...run].sort(
        (a, b) => (seedOrder.get(a) ?? 0) - (seedOrder.get(b) ?? 0),
      );
      for (const id of inSeedOrder) table.push({ ...(rows.get(id) as StandingsRow), rank });
    }
  }
  return table;
}
