import { describe, expect, test } from "bun:test";

import type { EndsConfig } from "./config";
import { computeEnds } from "./ends";
import { DIVISION_PRESETS } from "./presets";
import { eventLog, sides } from "./testing";

const petanque = DIVISION_PRESETS["petanque-male"]?.scoringConfig as EndsConfig;
const run = (log: ReturnType<typeof eventLog>) =>
  computeEnds({ config: petanque, participants: sides("a", "b"), events: log.events });

describe("ends", () => {
  test("each end goes to one side and the match stops at 13", () => {
    const log = eventLog();
    log.score("a", 3);
    log.score("b", 2);
    log.period(4);
    log.score("a", 6);
    let state = run(log);
    expect(state).toMatchObject({ period: 5, decided: false });
    expect(state.participants[0]?.detail?.parts).toEqual([3, 0, 0, 6]);
    expect(state.participants[1]?.detail?.parts).toEqual([0, 2, 0, 0]);
    expect(state.participants.map((p) => p.score)).toEqual([9, 2]);

    log.score("a", 4);
    state = run(log);
    expect(state).toMatchObject({ period: 5, decided: true });
    expect(state.participants.map((p) => [p.score, p.outcome])).toEqual([
      [13, "win"],
      [2, "loss"],
    ]);
    log.score("b", 5);
    expect(run(log).participants[1]?.score).toBe(2);
    expect(state.timeline.map((line) => line.text)).toEqual([
      "+3 (เอนด์ที่ 1)",
      "+2 (เอนด์ที่ 2)",
      "เริ่มเอนด์ที่ 4",
      "+6 (เอนด์ที่ 4)",
      "+4 (เอนด์ที่ 5)",
    ]);
  });

  test("an end never counts more than its maximum", () => {
    const log = eventLog();
    log.score("a", 9);
    expect(run(log).participants[0]?.score).toBe(6);
  });

  test("a period event for an end already played changes nothing", () => {
    const log = eventLog();
    log.score("a", 1);
    log.period(1);
    expect(run(log)).toMatchObject({ period: 2, timeline: [{ text: "+1 (เอนด์ที่ 1)" }] });
  });
});
