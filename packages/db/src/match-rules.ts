// Competition scores: the universities, match states and how finished matches
// add up to the standings. Kept free of Drizzle so the browser bundle can import it.

export const UNIVERSITIES = ["kmutt", "kmutnb", "kmitl"] as const;
export type University = (typeof UNIVERSITIES)[number];

export const UNIVERSITY_LABELS: Record<University, string> = {
  kmutt: "มจธ.",
  kmutnb: "มจพ.",
  kmitl: "สจล.",
};

export const MATCH_STATUSES = ["scheduled", "live", "finished"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * How a match's result reaches the audience: `live` shows the score as it
 * changes; `after` shows only the schedule, then the final ranking of the
 * universities once the match is over.
 */
export const ANNOUNCE_MODES = ["live", "after"] as const;
export type AnnounceMode = (typeof ANNOUNCE_MODES)[number];

/**
 * The places a ranking has: 1st, 2nd and 3rd. A university may hold several of
 * them, since many of its athletes run in the same race.
 */
export const RANKING_MAX = 3;

/**
 * How a pair match is reported: `points` counts a running score (football,
 * basketball); `sets` plays a best-of series scored set by set (badminton,
 * volleyball); `after` is reported only when it is over, as who won. A match
 * with many teams is always reported after, as a ranking.
 */
export const SCORING_MODES = ["points", "sets", "after"] as const;
export type ScoringMode = (typeof SCORING_MODES)[number];

/** Sets a side needs to win a series: 2 of 3, 3 of 5 or 4 of 7. */
export const SETS_TO_WIN_OPTIONS = [2, 3, 4] as const;

/** One set: each side's points, and whether the set is over. Only the last set may be running. */
export type MatchSet = { a: number; b: number; done: boolean };

/** Sets won by each side: only sets that are over count, and a tie counts for neither. */
export function setsWon(sets: readonly MatchSet[]) {
  let a = 0;
  let b = 0;
  for (const set of sets) {
    if (!set.done) continue;
    if (set.a > set.b) a += 1;
    else if (set.b > set.a) b += 1;
  }
  return { a, b };
}

/** Most sets a series can last: a side needs `toWin`, so 2 of 3, 3 of 5 or 4 of 7. */
export function maxSets(toWin: number) {
  return toWin * 2 - 1;
}

/** What is wrong with a series of sets for a best-of `toWin`, or null when it is fine. */
export function setsProblem(sets: readonly MatchSet[], toWin: number): string | null {
  if (sets.length > maxSets(toWin)) return "Too many sets for this series";
  let a = 0;
  let b = 0;
  for (const [index, set] of sets.entries()) {
    if (a === toWin || b === toWin) return "The series is already decided";
    if (!set.done) {
      if (index !== sets.length - 1) return "Only the last set may still be running";
      continue;
    }
    if (set.a === set.b) return "A finished set needs a winner";
    if (set.a > set.b) a += 1;
    else b += 1;
  }
  return null;
}

export const SPORT_MAX = 60;
export const DIVISION_MAX = 100;
export const ROUND_MAX = 60;
export const SCORE_MAX = 9999;
export const DURATION_MAX = 600;
export const BREAK_MAX = 120;
/** Most breaks one match may have. */
export const BREAKS_MAX = 20;

/** A pause in play: it starts `atMinute` minutes into play and lasts `minutes`. */
export type MatchBreak = { atMinute: number; minutes: number };

/** Standings points per result. */
export const POINTS = { win: 3, draw: 1, loss: 0 } as const;

export type MatchResult = {
  sport: string;
  teamA: University | null;
  teamB: University | null;
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  /** How the match is reported; matches reported after only count once they name a winner. */
  scoring?: ScoringMode;
  winner?: University | null;
};

export type Standing = {
  university: University;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
};

function emptyStandings(): Record<University, Standing> {
  return Object.fromEntries(
    UNIVERSITIES.map((university) => [
      university,
      { university, played: 0, won: 0, drawn: 0, lost: 0, points: 0 },
    ]),
  ) as Record<University, Standing>;
}

function addResult(standing: Standing, own: number, other: number) {
  standing.played += 1;
  if (own > other) {
    standing.won += 1;
    standing.points += POINTS.win;
  } else if (own === other) {
    standing.drawn += 1;
    standing.points += POINTS.draw;
  } else {
    standing.lost += 1;
    standing.points += POINTS.loss;
  }
}

function sorted(table: Record<University, Standing>) {
  return Object.values(table).sort(
    (a, b) =>
      b.points - a.points ||
      b.won - a.won ||
      UNIVERSITIES.indexOf(a.university) - UNIVERSITIES.indexOf(b.university),
  );
}

/**
 * Overall and per-sport standings. Only finished matches with both scores
 * count, so a live score never moves the table.
 */
export function computeStandings(matches: MatchResult[]) {
  const overall = emptyStandings();
  const bySport = new Map<string, Record<University, Standing>>();
  for (const match of matches) {
    if (match.status !== "finished") continue;
    // A match announced by ranking has no two sides, so it adds no points.
    if (match.teamA === null || match.teamB === null) continue;
    // Reported after it ends, a pair match is a win for the side named, or nothing.
    const reported = match.scoring === "after";
    if (reported && !match.winner) continue;
    if (!reported && (match.scoreA === null || match.scoreB === null)) continue;
    const scoreA = reported ? (match.winner === match.teamA ? 1 : 0) : (match.scoreA ?? 0);
    const scoreB = reported ? (match.winner === match.teamB ? 1 : 0) : (match.scoreB ?? 0);
    let sport = bySport.get(match.sport);
    if (!sport) {
      sport = emptyStandings();
      bySport.set(match.sport, sport);
    }
    for (const table of [overall, sport]) {
      addResult(table[match.teamA], scoreA, scoreB);
      addResult(table[match.teamB], scoreB, scoreA);
    }
  }
  return {
    overall: sorted(overall),
    bySport: [...bySport]
      .sort(([a], [b]) => a.localeCompare(b, "th"))
      .map(([sport, table]) => ({ sport, standings: sorted(table) })),
  };
}

export type Standings = ReturnType<typeof computeStandings>;
