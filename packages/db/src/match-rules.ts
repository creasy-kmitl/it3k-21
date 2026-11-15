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

export const SPORT_MAX = 60;
export const ROUND_MAX = 60;
export const SCORE_MAX = 9999;

/** Standings points per result. */
export const POINTS = { win: 3, draw: 1, loss: 0 } as const;

export type MatchResult = {
  sport: string;
  teamA: University;
  teamB: University;
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
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
    if (match.status !== "finished" || match.scoreA === null || match.scoreB === null) continue;
    let sport = bySport.get(match.sport);
    if (!sport) {
      sport = emptyStandings();
      bySport.set(match.sport, sport);
    }
    for (const table of [overall, sport]) {
      addResult(table[match.teamA], match.scoreA, match.scoreB);
      addResult(table[match.teamB], match.scoreB, match.scoreA);
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
