import { describe, expect, test } from "bun:test";

import { type PlannedMatch, planRoundRobin, roundRobinPairings } from "./round-robin";

const teams = (count: number, prefix = "t") =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

const pairKey = (a: string, b: string) => [a, b].toSorted().join("-");

const START = Date.UTC(2026, 11, 1, 2, 0);
const court = (name: string) => ({ venueId: "v1", court: name });

describe("roundRobinPairings", () => {
  test("an even group meets every other team once, one match per team per round", () => {
    const ids = teams(6);
    const pairings = roundRobinPairings(ids);
    expect(pairings).toHaveLength(15);
    expect(new Set(pairings.map((p) => pairKey(p.homeTeamId, p.awayTeamId))).size).toBe(15);
    expect(Math.max(...pairings.map((p) => p.roundNo))).toBe(5);
    for (let round = 1; round <= 5; round++) {
      const playing = pairings
        .filter((p) => p.roundNo === round)
        .flatMap((p) => [p.homeTeamId, p.awayTeamId]);
      expect(playing.toSorted()).toEqual(ids.toSorted());
    }
  });

  test("an odd group gives one team a bye each round", () => {
    const ids = teams(5);
    const pairings = roundRobinPairings(ids);
    expect(pairings).toHaveLength(10);
    expect(Math.max(...pairings.map((p) => p.roundNo))).toBe(5);
    const byes = new Map(ids.map((id) => [id, 0]));
    for (let round = 1; round <= 5; round++) {
      const playing = new Set(
        pairings.filter((p) => p.roundNo === round).flatMap((p) => [p.homeTeamId, p.awayTeamId]),
      );
      expect(playing.size).toBe(4);
      for (const id of ids) if (!playing.has(id)) byes.set(id, (byes.get(id) ?? 0) + 1);
    }
    // Everyone sits out exactly once.
    expect([...byes.values()]).toEqual([1, 1, 1, 1, 1]);
  });

  test("a second leg repeats every pairing with home and away swapped", () => {
    const pairings = roundRobinPairings(teams(4), 2);
    expect(pairings).toHaveLength(12);
    const first = pairings.filter((p) => p.roundNo <= 3);
    const second = pairings.filter((p) => p.roundNo > 3);
    expect(second.map((p) => `${p.awayTeamId}>${p.homeTeamId}`).toSorted()).toEqual(
      first.map((p) => `${p.homeTeamId}>${p.awayTeamId}`).toSorted(),
    );
  });

  test("home matches are spread out", () => {
    const pairings = roundRobinPairings(teams(6));
    const home = new Map<string, number>();
    for (const p of pairings) home.set(p.homeTeamId, (home.get(p.homeTeamId) ?? 0) + 1);
    for (const count of home.values()) expect(count).toBeGreaterThanOrEqual(2);
  });

  test("two teams play once, fewer play nothing, and duplicates are refused", () => {
    expect(roundRobinPairings(["a", "b"])).toEqual([
      { roundNo: 1, homeTeamId: "a", awayTeamId: "b" },
    ]);
    expect(roundRobinPairings(["a"])).toEqual([]);
    expect(() => roundRobinPairings(["a", "a"])).toThrow();
  });
});

function bySlot(matches: PlannedMatch[]) {
  const slots = new Map<number, PlannedMatch[]>();
  for (const match of matches) slots.set(match.slot, [...(slots.get(match.slot) ?? []), match]);
  return slots;
}

describe("planRoundRobin", () => {
  test("fills the courts in parallel, one slot every slotMinutes", () => {
    const plan = planRoundRobin({
      groups: [{ name: "A", teamIds: teams(4) }],
      firstStartAt: START,
      slotMinutes: 30,
      courts: [court("1"), court("2")],
      legs: 1,
    });
    expect(plan.matches).toHaveLength(6);
    expect(plan.slots).toBe(3);
    expect(plan.endsAt).toBe(START + 90 * 60_000);
    expect(plan.matches.map((m) => [m.slot, m.court, m.matchNo])).toEqual([
      [0, "1", 1],
      [0, "2", 2],
      [1, "1", 3],
      [1, "2", 4],
      [2, "1", 5],
      [2, "2", 6],
    ]);
    expect(plan.matches[2]?.startAt).toBe(START + 30 * 60_000);
  });

  test("never has a team play twice in a slot, and plays each team's rounds in order", () => {
    const plan = planRoundRobin({
      groups: [
        { name: "A", teamIds: teams(5, "a") },
        { name: "B", teamIds: teams(4, "b") },
      ],
      firstStartAt: START,
      slotMinutes: 20,
      courts: [court("1"), court("2"), court("3")],
      legs: 2,
    });
    expect(plan.matches).toHaveLength(20 + 12);
    for (const matches of bySlot(plan.matches).values()) {
      expect(matches.length).toBeLessThanOrEqual(3);
      const playing = matches.flatMap((m) => [m.homeTeamId, m.awayTeamId]);
      expect(new Set(playing).size).toBe(playing.length);
    }
    const lastRound = new Map<string, number>();
    for (const match of plan.matches.toSorted((x, y) => x.slot - y.slot)) {
      for (const team of [match.homeTeamId, match.awayTeamId]) {
        expect(match.roundNo).toBeGreaterThanOrEqual(lastRound.get(team) ?? 0);
        lastRound.set(team, match.roundNo);
      }
    }
    expect(new Set(plan.matches.map((m) => m.matchNo)).size).toBe(plan.matches.length);
    expect(plan.matches.filter((m) => m.groupName === "B").every((m) => m.groupIndex === 1)).toBe(
      true,
    );
  });

  test("more courts than a round needs leaves the extra courts free", () => {
    const plan = planRoundRobin({
      groups: [{ name: "A", teamIds: teams(3) }],
      firstStartAt: START,
      slotMinutes: 60,
      courts: [court("1"), court("2")],
      legs: 1,
    });
    // Three teams: one match a round, so one match a slot.
    expect(plan.matches.map((m) => m.slot)).toEqual([0, 1, 2]);
  });

  test("counts match numbers on from firstMatchNo", () => {
    const plan = planRoundRobin({
      groups: [{ name: "A", teamIds: teams(2) }],
      firstStartAt: START,
      slotMinutes: 60,
      courts: [{ venueId: null, court: null }],
      legs: 2,
      firstMatchNo: 11,
    });
    expect(plan.matches.map((m) => m.matchNo)).toEqual([11, 12]);
    expect(plan.matches[1]).toMatchObject({ homeTeamId: "t2", awayTeamId: "t1", roundNo: 2 });
  });

  test("refuses a team in two groups", () => {
    expect(() =>
      planRoundRobin({
        groups: [
          { name: "A", teamIds: ["x", "y"] },
          { name: "B", teamIds: ["y", "z"] },
        ],
        firstStartAt: START,
        slotMinutes: 30,
        courts: [court("1")],
        legs: 1,
      }),
    ).toThrow();
  });
});
