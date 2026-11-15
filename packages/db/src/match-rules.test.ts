import { describe, expect, test } from "bun:test";

import { type MatchResult, computeStandings } from "./match-rules";

const game = (input: Partial<MatchResult>): MatchResult => ({
  sport: "ฟุตบอล",
  teamA: "kmutt",
  teamB: "kmitl",
  scoreA: null,
  scoreB: null,
  status: "finished",
  ...input,
});

describe("computeStandings", () => {
  test("wins, draws and losses add up per university and per sport", () => {
    const { overall, bySport } = computeStandings([
      game({ scoreA: 3, scoreB: 1 }),
      game({ sport: "บาสเกตบอล", teamA: "kmitl", teamB: "kmutnb", scoreA: 40, scoreB: 40 }),
    ]);
    expect(overall).toEqual([
      { university: "kmutt", played: 1, won: 1, drawn: 0, lost: 0, points: 3 },
      { university: "kmutnb", played: 1, won: 0, drawn: 1, lost: 0, points: 1 },
      { university: "kmitl", played: 2, won: 0, drawn: 1, lost: 1, points: 1 },
    ]);
    expect(bySport.map((entry) => entry.sport)).toEqual(["บาสเกตบอล", "ฟุตบอล"]);
  });

  test("unfinished or unscored matches do not count", () => {
    const { overall, bySport } = computeStandings([
      game({ scoreA: 1, scoreB: 0, status: "live" }),
      game({ scoreA: 1, scoreB: null }),
    ]);
    expect(overall.every((row) => row.played === 0)).toBe(true);
    expect(bySport).toEqual([]);
  });
});
