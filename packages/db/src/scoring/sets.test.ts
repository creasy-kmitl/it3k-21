import { describe, expect, test } from "bun:test";

import type { SetsConfig } from "./config";
import { DIVISION_PRESETS } from "./presets";
import { INTERVAL_TEXT, atInterval, computeSets, wonSet } from "./sets";
import { eventLog, sides } from "./testing";

const preset = (code: string) => DIVISION_PRESETS[code]?.scoringConfig as SetsConfig;
const badminton = preset("badminton-singles-male");
const tableTennis = preset("table-tennis-singles-male");
const valorant = preset("esports-valorant");

const run = (config: SetsConfig, log: ReturnType<typeof eventLog>) =>
  computeSets({ config, participants: sides("a", "b"), events: log.events });

describe("sets: winning a set", () => {
  test("badminton: 15 points, by 2, no further than 21", () => {
    expect(wonSet(badminton, 15, 13)).toBe(true);
    expect(wonSet(badminton, 15, 14)).toBe(false);
    expect(wonSet(badminton, 17, 15)).toBe(true);
    expect(wonSet(badminton, 20, 19)).toBe(false);
    expect(wonSet(badminton, 21, 20)).toBe(true);
    // Table tennis has no cap: deuce goes on.
    expect(wonSet(tableTennis, 15, 14)).toBe(false);
    expect(wonSet(tableTennis, 16, 14)).toBe(true);
  });

  test("a set ends on its own and the next rally starts the next set", () => {
    const log = eventLog();
    log.rally("a", 14);
    log.rally("b", 14);
    log.rally("a", 1);
    let state = run(badminton, log);
    expect(state.period).toBe(1);
    expect(state.participants.map((p) => p.score)).toEqual([0, 0]);
    log.rally("a", 1);
    state = run(badminton, log);
    expect(state.period).toBe(2);
    expect(state.participants.map((p) => p.score)).toEqual([1, 0]);
    expect(state.participants[0]?.detail).toEqual({ parts: [16, 0], won: 1 });
    expect(state.participants[1]?.detail).toEqual({ parts: [14, 0], won: 0 });
    expect(state.timeline.at(-1)).toMatchObject({ text: "จบเกมที่ 1 (16-14)", participantId: "a" });
  });

  test("at 20-20 the next point takes the set at the cap", () => {
    const log = eventLog();
    log.rally("a", 14);
    log.rally("b", 14);
    for (let i = 0; i < 6; i++) {
      log.rally("a", 1);
      log.rally("b", 1);
    }
    log.rally("b", 1);
    const state = run(badminton, log);
    expect(state.participants[1]?.detail?.parts).toEqual([21, 0]);
    expect(state.participants[0]?.detail?.parts).toEqual([20, 0]);
    expect(state.participants.map((p) => p.score)).toEqual([0, 1]);
  });
});

describe("sets: the match", () => {
  test("best of three: the match is decided at two sets and later points are left out", () => {
    const log = eventLog();
    log.rally("a", 15);
    log.rally("b", 15);
    let state = run(badminton, log);
    expect(state).toMatchObject({ period: 3, decided: false });
    log.rally("a", 15);
    state = run(badminton, log);
    expect(state).toMatchObject({ period: 3, decided: true });
    expect(state.participants.map((p) => [p.score, p.rank, p.outcome])).toEqual([
      [2, 1, "win"],
      [1, 2, "loss"],
    ]);
    log.rally("b", 3);
    const after = run(badminton, log);
    expect(after.participants[1]?.detail?.parts).toEqual([0, 15, 0]);
  });

  test("table tennis is best of five", () => {
    const log = eventLog();
    for (let i = 0; i < 2; i++) {
      log.rally("a", 11);
      log.rally("b", 11);
    }
    expect(run(tableTennis, log).decided).toBe(false);
    log.rally("b", 11);
    const state = run(tableTennis, log);
    expect(state.decided).toBe(true);
    expect(state.participants[1]?.detail).toEqual({ parts: [0, 11, 0, 11, 11], won: 3 });
  });

  test("a Valorant map is one set to 13 by 2 with no cap", () => {
    const log = eventLog();
    log.rally("a", 12);
    log.rally("b", 12);
    log.rally("a", 1);
    expect(run(valorant, log).decided).toBe(false);
    log.rally("b", 1);
    log.rally("b", 1);
    log.rally("b", 1);
    const state = run(valorant, log);
    expect(state.decided).toBe(true);
    expect(state.participants[1]?.detail).toEqual({ parts: [15], won: 1 });
  });

  test("undo of the set point reopens the set", () => {
    const log = eventLog();
    log.rally("a", 14);
    const setPoint = log.score("a");
    expect(run(badminton, log).period).toBe(2);
    log.void(setPoint);
    const state = run(badminton, log);
    expect(state.period).toBe(1);
    expect(state.participants[0]?.detail?.parts).toEqual([14]);
  });
});

describe("sets: the break", () => {
  test("the leader reaching 8 calls the break once per set", () => {
    const log = eventLog();
    log.rally("a", 7);
    log.rally("b", 7);
    expect(atInterval(run(badminton, log))).toBe(false);
    log.rally("b", 1);
    let state = run(badminton, log);
    expect(atInterval(state)).toBe(true);
    expect(state.timeline.at(-1)?.text).toBe(INTERVAL_TEXT);
    log.rally("a", 1);
    state = run(badminton, log);
    expect(atInterval(state)).toBe(false);
    expect(state.timeline.filter((line) => line.text === INTERVAL_TEXT)).toHaveLength(1);
    // The next set has its own break.
    log.rally("a", 7);
    log.rally("b", 15 - 8);
    log.rally("a", 8);
    state = run(badminton, log);
    expect(state.period).toBe(2);
    expect(state.timeline.filter((line) => line.text === INTERVAL_TEXT)).toHaveLength(2);
  });

  test("table tennis has no break", () => {
    const log = eventLog();
    log.rally("a", 8);
    expect(run(tableTennis, log).timeline.some((l) => l.text === INTERVAL_TEXT)).toBe(false);
  });
});
