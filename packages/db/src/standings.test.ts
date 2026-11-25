import { describe, expect, test } from "bun:test";

import type { ParticipantDetail, StandingsConfig } from "./competition-rules";
import { type StandingsMatch, computeStandings } from "./standings";

const football: StandingsConfig = {
  win: 3,
  draw: 1,
  loss: 0,
  forfeit: 0,
  tiebreaks: ["headToHead", "scoreDiff", "scoreFor"],
};

function game(
  a: string,
  scoreA: number,
  b: string,
  scoreB: number,
  extra: Partial<StandingsMatch> = {},
  details: [ParticipantDetail | null, ParticipantDetail | null] = [null, null],
): StandingsMatch {
  const outcome = (mine: number, theirs: number) =>
    mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
  return {
    status: "finished",
    outcome: "played",
    friendly: false,
    sides: [
      { teamId: a, score: scoreA, detail: details[0], outcome: outcome(scoreA, scoreB) },
      { teamId: b, score: scoreB, detail: details[1], outcome: outcome(scoreB, scoreA) },
    ],
    ...extra,
  };
}

const order = (rows: { teamId: string }[]) => rows.map((row) => row.teamId);

describe("computeStandings", () => {
  test("adds up points, goals and records from finished matches", () => {
    const rows = computeStandings({
      teamIds: ["A", "B", "C"],
      config: football,
      matches: [game("A", 2, "B", 0), game("B", 1, "C", 1), game("C", 0, "A", 3)],
    });
    expect(order(rows)).toEqual(["A", "B", "C"]);
    expect(rows[0]).toMatchObject({
      played: 2,
      wins: 2,
      draws: 0,
      losses: 0,
      scoreFor: 5,
      scoreAgainst: 0,
      scoreDiff: 5,
      points: 6,
      rank: 1,
    });
    // B and C both have a point and -2: head-to-head was a draw, then goals
    // scored (1 each) leave them level, so they share second in seed order.
    expect(rows[1]).toMatchObject({ points: 1, scoreDiff: -2, rank: 2 });
    expect(rows[2]).toMatchObject({ points: 1, scoreDiff: -3, rank: 3 });
  });

  test("skips unfinished, friendly and no-contest matches and outside teams", () => {
    const rows = computeStandings({
      teamIds: ["A", "B"],
      config: football,
      matches: [
        game("A", 1, "B", 0, { status: "live" }),
        game("A", 1, "B", 0, { friendly: true }),
        game("A", 1, "B", 0, { outcome: "no_contest" }),
        game("A", 5, "X", 0),
      ],
    });
    expect(rows.every((row) => row.played === 0 && row.points === 0)).toBe(true);
    expect(rows.map((row) => row.rank)).toEqual([1, 1]);
  });

  test("a forfeit earns the forfeit points and counts as a loss", () => {
    const config = { ...football, forfeit: -1 };
    const match: StandingsMatch = {
      status: "finished",
      outcome: "forfeit",
      friendly: false,
      sides: [
        { teamId: "A", score: null, detail: null, outcome: "walkover_win" },
        { teamId: "B", score: null, detail: null, outcome: "forfeit" },
      ],
    };
    const rows = computeStandings({ teamIds: ["A", "B"], config, matches: [match] });
    expect(rows[0]).toMatchObject({ teamId: "A", wins: 1, points: 3 });
    expect(rows[1]).toMatchObject({ teamId: "B", losses: 1, forfeits: 1, points: -1 });
  });

  test("with no outcome cached, the scores decide", () => {
    const match = game("A", 1, "B", 2);
    for (const side of match.sides) side.outcome = null;
    const rows = computeStandings({ teamIds: ["A", "B"], config: football, matches: [match] });
    expect(order(rows)).toEqual(["B", "A"]);
  });

  test("head-to-head beats goal difference, and is read among the teams still level", () => {
    // A, B and C all finish on 6 points. B has the best goal difference but
    // lost to A; C beat B. Head-to-head among the three is level (3 each), so
    // goal difference splits them: B, then A and C, who meet head-to-head again.
    const rows = computeStandings({
      teamIds: ["A", "B", "C", "D"],
      config: football,
      matches: [
        game("A", 1, "B", 0),
        game("B", 2, "C", 0),
        game("C", 1, "A", 0),
        game("A", 1, "D", 0),
        game("B", 9, "D", 0),
        game("C", 2, "D", 0),
      ],
    });
    expect(rows.map((row) => row.points)).toEqual([6, 6, 6, 0]);
    // Goal differences: B +10, A +1, C +1. A and C stay level, and C beat A.
    expect(order(rows)).toEqual(["B", "C", "A", "D"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
  });

  test("set and point ratios separate teams in set-based sports", () => {
    const config: StandingsConfig = {
      win: 2,
      draw: 0,
      loss: 1,
      forfeit: 0,
      tiebreaks: ["setRatio", "pointRatio"],
    };
    const won = (sets: number, parts: number[]): ParticipantDetail => ({ won: sets, parts });
    const rows = computeStandings({
      teamIds: ["A", "B", "C"],
      config,
      matches: [
        game("A", 2, "B", 1, {}, [won(2, [21, 18, 21]), won(1, [15, 21, 19])]),
        game("B", 2, "C", 0, {}, [won(2, [21, 21]), won(0, [10, 12])]),
        game("C", 2, "A", 0, {}, [won(2, [21, 21]), won(0, [19, 19])]),
      ],
    });
    // Everyone 1-1 on 3 points. Sets: A 2/3, B 3/2, C 2/2.
    expect(order(rows)).toEqual(["B", "C", "A"]);
    expect(rows[0]).toMatchObject({ setsFor: 3, setsAgainst: 2, pointsFor: 97, points: 3 });
  });

  test("an unbeaten set ratio ranks first without breaking the sort", () => {
    const config: StandingsConfig = { ...football, tiebreaks: ["setRatio", "wins"] };
    const won = (sets: number): ParticipantDetail => ({ won: sets });
    const rows = computeStandings({
      teamIds: ["A", "B", "C"],
      config: { ...config, win: 0, loss: 0 },
      matches: [
        game("A", 1, "C", 0, {}, [won(2), won(0)]),
        game("B", 1, "C", 0, {}, [won(2), won(0)]),
      ],
    });
    // A and B are both unbeaten (Infinity), then wins leave them level.
    expect(order(rows)).toEqual(["A", "B", "C"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 3]);
  });
});
