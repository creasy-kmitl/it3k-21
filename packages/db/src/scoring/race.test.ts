import { describe, expect, test } from "bun:test";

import type { RaceConfig } from "./config";
import { DIVISION_PRESETS } from "./presets";
import { computeRace, formatRaceValue } from "./race";
import { eventLog, sides } from "./testing";

const sprint = DIVISION_PRESETS["athletics-100m-male"]?.scoringConfig as RaceConfig;
const tft = DIVISION_PRESETS["esports-tft"]?.scoringConfig as RaceConfig;

const run = (config: RaceConfig, log: ReturnType<typeof eventLog>, ...ids: string[]) =>
  computeRace({ config, participants: sides(...ids), events: log.events });

describe("race: times and distances", () => {
  test("a 100m heat ranks the lowest times first and leaves DNF and DQ unranked", () => {
    const log = eventLog();
    log.result("a", 11_420);
    log.result("b", 10_980);
    log.result("c", null, "dnf");
    let state = run(sprint, log, "a", "b", "c", "d");
    // d has no result yet: ranks show, the race is not decided.
    expect(state.decided).toBe(false);
    expect(state.participants.map((p) => p.rank)).toEqual([2, 1, null, null]);
    expect(state.participants.map((p) => p.outcome)).toEqual([null, null, null, null]);

    log.result("d", 9_000, "dq");
    state = run(sprint, log, "a", "b", "c", "d");
    expect(state.decided).toBe(true);
    expect(state.participants.map((p) => [p.rank, p.outcome, p.resultValue])).toEqual([
      [2, "loss", 11_420],
      [1, "win", 10_980],
      [null, "loss", null],
      [null, "loss", null],
    ]);
    expect(state.participants.map((p) => p.detail?.status)).toEqual(["ok", "ok", "dnf", "dq"]);
    expect(state.participants[0]?.score).toBeNull();
    expect(state.timeline.map((line) => line.text)).toEqual([
      "11.42 วิ",
      "10.98 วิ",
      "แข่งไม่จบ (DNF)",
      "ถูกตัดสิทธิ์ (DQ)",
    ]);
  });

  test("with one game a new result replaces the old one", () => {
    const log = eventLog();
    log.result("a", 12_000);
    log.result("a", 11_000);
    log.result("b", 11_500);
    const state = run(sprint, log, "a", "b");
    expect(state.participants.map((p) => [p.resultValue, p.rank])).toEqual([
      [11_000, 1],
      [11_500, 2],
    ]);
  });

  test("equal times share a rank", () => {
    const log = eventLog();
    log.result("a", 11_000);
    log.result("b", 11_000);
    log.result("c", 12_000);
    const state = run(sprint, log, "a", "b", "c");
    expect(state.participants.map((p) => [p.rank, p.outcome])).toEqual([
      [1, "draw"],
      [1, "draw"],
      [3, "loss"],
    ]);
  });

  test("distances rank the highest first", () => {
    const jump: RaceConfig = { ...sprint, measure: "distance", lowerIsBetter: false };
    const log = eventLog();
    log.result("a", 6_120);
    log.result("b", 6_450);
    const state = run(jump, log, "a", "b");
    expect(state.participants.map((p) => p.rank)).toEqual([2, 1]);
    expect(formatRaceValue("distance", 6_450)).toBe("6.45 ม.");
  });

  test("several timed games add up placement points", () => {
    const series: RaceConfig = { ...sprint, games: 2, placementPoints: [5, 3, 1] };
    const log = eventLog();
    log.result("a", 10_000);
    log.result("b", 11_000);
    log.result("c", 12_000);
    let state = run(series, log, "a", "b", "c");
    expect(state).toMatchObject({ period: 2, decided: false });
    log.result("a", 13_000);
    log.result("b", 11_000);
    log.result("c", null, "dns");
    state = run(series, log, "a", "b", "c");
    expect(state.decided).toBe(true);
    expect(state.participants.map((p) => [p.score, p.detail?.parts, p.rank])).toEqual([
      [8, [5, 3], 1],
      [8, [3, 5], 1],
      [1, [1, 0], 3],
    ]);
  });

  test("times add up over several games when decided by total", () => {
    const relay: RaceConfig = { ...sprint, games: 2 };
    const log = eventLog();
    log.result("a", 10_000);
    log.result("b", 9_000);
    log.result("a", 10_000);
    log.result("b", 12_000);
    const state = run(relay, log, "a", "b");
    expect(state.participants.map((p) => [p.resultValue, p.rank])).toEqual([
      [20_000, 1],
      [21_000, 2],
    ]);
  });
});

describe("race: placements", () => {
  test("TFT: four players a side, placement points 8 down to 1", () => {
    const log = eventLog();
    const placesA = [1, 4, 5, 8];
    const placesB = [2, 3, 6, 7];
    for (const [i, place] of placesA.entries()) log.place("a", 1, place, `a${i}`);
    for (const [i, place] of placesB.slice(0, 3).entries()) log.place("b", 1, place, `b${i}`);
    let state = run(tft, log, "a", "b");
    // Every side has played: placings may still come in, but the game counts.
    expect(state.participants.map((p) => p.score)).toEqual([8 + 5 + 4 + 1, 7 + 6 + 3]);
    log.place("b", 1, 7, "b3");
    state = run(tft, log, "a", "b");
    expect(state.decided).toBe(true);
    expect(state.participants.map((p) => [p.score, p.detail?.won, p.outcome])).toEqual([
      [18, 1, "draw"],
      [18, 1, "draw"],
    ]);
    // A correction replaces that player's place.
    log.place("b", 1, 8, "b3");
    state = run(tft, log, "a", "b");
    expect(state.participants.map((p) => [p.score, p.outcome])).toEqual([
      [18, "win"],
      [17, "loss"],
    ]);
    expect(state.timeline.at(-1)).toMatchObject({ text: "อันดับ 8", registrationId: "b3" });
  });

  test("best of three lobbies by game wins, decided once out of reach", () => {
    const bo3: RaceConfig = { ...tft, games: 3 };
    const log = eventLog();
    for (const game of [1, 2]) {
      log.place("a", game, 1);
      log.place("b", game, 2);
    }
    const state = run(bo3, log, "a", "b");
    expect(state.decided).toBe(true);
    expect(state.period).toBe(3);
    expect(state.participants.map((p) => [p.score, p.detail?.won, p.outcome])).toEqual([
      [16, 2, "win"],
      [14, 0, "loss"],
    ]);
  });

  test("without placement points the lowest summed place wins", () => {
    const config: RaceConfig = { ...tft, placementPoints: null, decideBy: "total" };
    const log = eventLog();
    log.place("a", 1, 1, "a1");
    log.place("a", 1, 6, "a2");
    log.place("b", 1, 2, "b1");
    log.place("b", 1, 3, "b2");
    const state = run(config, log, "a", "b");
    expect(state.participants.map((p) => [p.score, p.rank])).toEqual([
      [7, 2],
      [5, 1],
    ]);
  });
});

test("formatRaceValue", () => {
  expect(formatRaceValue("time", 10_980)).toBe("10.98 วิ");
  expect(formatRaceValue("time", 62_350)).toBe("1:02.35 นาที");
});
