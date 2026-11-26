import { describe, expect, test } from "bun:test";

import type { SeriesConfig } from "./config";
import { DIVISION_PRESETS } from "./presets";
import { computeSeries } from "./series";
import { eventLog, sides } from "./testing";

const tugOfWar = DIVISION_PRESETS["folk-tug-of-war"]?.scoringConfig as SeriesConfig;
const rov = DIVISION_PRESETS["esports-rov"]?.scoringConfig as SeriesConfig;

describe("series", () => {
  test("tug-of-war is best of three pulls", () => {
    const log = eventLog();
    log.game("a");
    log.game("b");
    let state = computeSeries({
      config: tugOfWar,
      participants: sides("a", "b"),
      events: log.events,
    });
    expect(state).toMatchObject({ period: 3, decided: false });
    log.game("b");
    log.game("a");
    state = computeSeries({ config: tugOfWar, participants: sides("a", "b"), events: log.events });
    expect(state).toMatchObject({ period: 3, decided: true });
    expect(state.participants.map((p) => [p.score, p.outcome])).toEqual([
      [1, "loss"],
      [2, "win"],
    ]);
    expect(state.participants[1]?.detail).toEqual({ parts: [0, 1, 1], won: 2 });
    expect(state.timeline.map((line) => line.text)).toEqual([
      "ชนะครั้งที่ 1",
      "ชนะครั้งที่ 2",
      "ชนะครั้งที่ 3",
    ]);
  });

  test("an ROV group game is one game", () => {
    const log = eventLog();
    log.game("b");
    const state = computeSeries({ config: rov, participants: sides("a", "b"), events: log.events });
    expect(state.decided).toBe(true);
    expect(state.participants.map((p) => p.rank)).toEqual([2, 1]);
  });

  test("games from sub-matches count once each sub-match has a winner", () => {
    const config: SeriesConfig = { ...tugOfWar, gamesToWin: 3, fromSubMatches: true };
    const log = eventLog();
    // Game events are ignored when sub-matches carry the games.
    log.game("a");
    const state = computeSeries({
      config,
      participants: sides("a", "b"),
      events: log.events,
      subMatches: [
        { winnerParticipantId: "b" },
        { winnerParticipantId: "a" },
        { winnerParticipantId: null },
        { winnerParticipantId: "b" },
      ],
    });
    expect(state.decided).toBe(false);
    expect(state.participants.map((p) => p.score)).toEqual([1, 2]);
    expect(state.participants[1]?.detail?.parts).toEqual([1, 0, 1]);
    expect(state.timeline).toEqual([]);
  });
});
