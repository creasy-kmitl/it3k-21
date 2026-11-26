import { describe, expect, test } from "bun:test";

import type { PointsConfig } from "./config";
import { computeMatchState } from "./index";
import { computePoints, pointsPeriodLabel, shootoutWinner } from "./points";
import { DIVISION_PRESETS } from "./presets";
import { eventLog, sides } from "./testing";

const preset = (code: string) => DIVISION_PRESETS[code]?.scoringConfig as PointsConfig;
const football = preset("football");
const basketball = preset("basketball-5x5-male");
const threeByThree = preset("basketball-3x3-female");
const chairball = preset("chairball-male");

const run = (config: PointsConfig, log: ReturnType<typeof eventLog>) =>
  computePoints({ config, participants: sides("a", "b"), events: log.events });

const scores = (state: ReturnType<typeof run>) => state.participants.map((p) => p.score);
const outcomes = (state: ReturnType<typeof run>) => state.participants.map((p) => p.outcome);

describe("points: regular time", () => {
  test("goals add up per half and the match ends when regular time does", () => {
    const log = eventLog();
    log.score("a");
    log.period(2);
    log.score("b");
    log.score("a", 1, "reg-9");
    let state = run(football, log);
    expect(scores(state)).toEqual([2, 1]);
    expect(state.participants[0]?.detail?.parts).toEqual([1, 1]);
    expect(state.participants[1]?.detail?.parts).toEqual([0, 1]);
    expect(state).toMatchObject({ period: 2, phase: "regular", decided: false });
    expect(outcomes(state)).toEqual([null, null]);

    log.period(3);
    state = run(football, log);
    expect(state.decided).toBe(true);
    expect(state.phase).toBe("regular");
    expect(outcomes(state)).toEqual(["win", "loss"]);
    expect(state.participants.map((p) => p.rank)).toEqual([1, 2]);
    // Moving on closed the second half; no third part appears.
    expect(state.participants[0]?.detail?.parts).toEqual([1, 1]);
    expect(state.timeline.map((line) => line.text)).toEqual([
      "+1",
      "เริ่มครึ่งที่ 2",
      "+1",
      "+1",
      "หมดเวลาการแข่งขัน",
    ]);
    expect(state.timeline[3]).toMatchObject({
      participantId: "a",
      registrationId: "reg-9",
      period: 2,
    });
  });

  test("a group match may end level", () => {
    const log = eventLog();
    log.score("a");
    log.score("b");
    log.period(3);
    const state = run(football, log);
    expect(state.decided).toBe(true);
    expect(outcomes(state)).toEqual(["draw", "draw"]);
    expect(state.participants.map((p) => p.rank)).toEqual([1, 1]);
  });

  test("basketball counts 1, 2 and 3 over four quarters", () => {
    const log = eventLog();
    log.score("a", 3);
    log.score("b", 2);
    log.period(2);
    log.score("b", 1);
    log.period(4);
    log.score("a", 2);
    const state = run(basketball, log);
    expect(scores(state)).toEqual([5, 3]);
    // A skipped quarter shows as nothing scored.
    expect(state.participants[0]?.detail?.parts).toEqual([3, 0, 0, 2]);
    expect(state.participants[1]?.detail?.parts).toEqual([2, 1, 0, 0]);
  });

  test("voided events are left out, in seq order whatever the array order", () => {
    const log = eventLog();
    const wrong = log.score("a", 3);
    log.score("b", 2);
    log.void(wrong);
    const state = computePoints({
      config: basketball,
      participants: sides("a", "b"),
      events: [...log.events].reverse(),
    });
    expect(scores(state)).toEqual([0, 2]);
    expect(state.timeline).toHaveLength(1);
  });

  test("stats are counted per side and shown, but never scored", () => {
    const log = eventLog();
    log.stat("a", "foul");
    log.stat("a", "foul");
    log.stat("b", "yellow");
    const state = run(football, log);
    expect(scores(state)).toEqual([0, 0]);
    expect(state.participants[0]?.detail?.stats).toEqual({ foul: 2 });
    expect(state.participants[1]?.detail?.stats).toEqual({ yellow: 1 });
    expect(state.timeline.map((line) => line.text)).toEqual(["ฟาวล์", "ฟาวล์", "ใบเหลือง"]);
  });
});

describe("points: overtime and shootouts", () => {
  test("a level basketball game goes to overtime until a period ends with a leader", () => {
    const log = eventLog();
    log.score("a", 2);
    log.score("b", 2);
    log.period(5);
    let state = run(basketball, log);
    expect(state).toMatchObject({ phase: "overtime", decided: false, period: 5 });
    expect(state.timeline.at(-1)?.text).toBe("เริ่มต่อเวลา 1");

    // A basket in overtime does not end it: only the end of the period does.
    log.score("a", 3);
    state = run(basketball, log);
    expect(state.decided).toBe(false);
    expect(state.participants[0]?.detail?.parts).toEqual([2, 0, 0, 0, 3]);

    log.score("b", 3);
    log.period(6);
    state = run(basketball, log);
    expect(state).toMatchObject({ phase: "overtime", decided: false, period: 6 });
    expect(state.timeline.at(-1)?.text).toBe("เริ่มต่อเวลา 2");

    log.score("b", 1);
    log.period(7);
    state = run(basketball, log);
    expect(state).toMatchObject({ phase: "overtime", decided: true });
    expect(outcomes(state)).toEqual(["loss", "win"]);
    expect(state.participants[1]?.detail?.parts).toEqual([2, 0, 0, 0, 3, 1]);
  });

  test("chairball: overtime, then a shootout counted apart from the score", () => {
    const log = eventLog();
    log.score("a", 2);
    log.score("b", 2);
    log.period(3);
    log.period(4);
    let state = run(chairball, log);
    expect(state).toMatchObject({ phase: "overtime", decided: false });

    log.shootout("a", true);
    log.shootout("b", false);
    state = run(chairball, log);
    expect(state.phase).toBe("shootout");
    expect(state.decided).toBe(false);
    expect(state.participants[0]?.detail?.shootout).toEqual({ scored: 1, taken: 1 });

    for (let i = 0; i < 2; i++) {
      log.shootout("a", true);
      log.shootout("b", true);
    }
    log.shootout("a", true);
    state = run(chairball, log);
    // 4 of 4 against 2 of 3 with two kicks left: b can still level.
    expect(state.decided).toBe(false);
    log.shootout("b", false);
    state = run(chairball, log);
    expect(state.decided).toBe(true);
    expect(scores(state)).toEqual([2, 2]);
    expect(outcomes(state)).toEqual(["win", "loss"]);
    expect(state.participants.map((p) => p.rank)).toEqual([1, 2]);
    expect(state.timeline.at(-1)).toMatchObject({ text: "ยิงโทษไม่เข้า", participantId: "b" });
  });

  test("a football knockout settles a draw with penalties", () => {
    const knockout = { ...football, allowDraw: false };
    const log = eventLog();
    log.period(3);
    expect(run(knockout, log)).toMatchObject({ phase: "shootout", decided: false });
    // In a group match a shootout entered after a draw still decides it.
    for (let i = 0; i < 5; i++) {
      log.shootout("a", true);
      log.shootout("b", i < 4);
    }
    expect(run(knockout, log).decided).toBe(true);
    expect(outcomes(run(football, log))).toEqual(["win", "loss"]);
  });

  test("shootout rules: early finish and sudden death", () => {
    const k = 5;
    expect(shootoutWinner({ scored: 3, taken: 3 }, { scored: 0, taken: 3 }, k)).toBe("a");
    expect(shootoutWinner({ scored: 3, taken: 3 }, { scored: 1, taken: 3 }, k)).toBeNull();
    expect(shootoutWinner({ scored: 5, taken: 5 }, { scored: 5, taken: 5 }, k)).toBeNull();
    expect(shootoutWinner({ scored: 6, taken: 6 }, { scored: 5, taken: 5 }, k)).toBeNull();
    expect(shootoutWinner({ scored: 6, taken: 6 }, { scored: 5, taken: 6 }, k)).toBe("a");
    expect(shootoutWinner({ scored: 6, taken: 7 }, { scored: 7, taken: 7 }, k)).toBe("b");
  });

  test("with no overtime or shootout a level knockout waits for staff", () => {
    const config = { ...football, allowDraw: false, shootout: null };
    const log = eventLog();
    log.period(3);
    expect(run(config, log)).toMatchObject({ decided: false, phase: "regular" });
  });
});

describe("points: target scores", () => {
  test("3x3 basketball ends as soon as a side reaches 15", () => {
    const log = eventLog();
    for (let i = 0; i < 7; i++) log.score("a", 2);
    log.score("b", 2);
    let state = run(threeByThree, log);
    expect(state.decided).toBe(false);
    log.score("a", 1);
    state = run(threeByThree, log);
    expect(state.decided).toBe(true);
    expect(scores(state)).toEqual([15, 2]);
    expect(outcomes(state)).toEqual(["win", "loss"]);
  });

  test("the 3x3 final plays to 21 and needs a lead of 2", () => {
    const final = { ...threeByThree, targetScore: 21, targetWinBy: 2 };
    const log = eventLog();
    for (let i = 0; i < 10; i++) {
      log.score("a", 2);
      log.score("b", 2);
    }
    log.score("a", 1);
    let state = run(final, log);
    expect(scores(state)).toEqual([21, 20]);
    expect(state.decided).toBe(false);
    log.score("b", 1);
    log.score("b", 1);
    state = run(final, log);
    expect(state.decided).toBe(false);
    log.score("b", 1);
    state = run(final, log);
    expect(scores(state)).toEqual([21, 23]);
    expect(state.decided).toBe(true);
    expect(outcomes(state)).toEqual(["loss", "win"]);
  });

  test("3x3 ends on time with a leader when nobody reached the target", () => {
    const log = eventLog();
    log.score("a", 2);
    log.period(2);
    const state = run(threeByThree, log);
    expect(state.decided).toBe(true);
    expect(outcomes(state)).toEqual(["win", "loss"]);
  });
});

describe("points: clock", () => {
  test("there is no clock unless the settings or the scorer use one", () => {
    expect(run(football, eventLog()).clock).toBeNull();
  });

  test("the clock follows its events and resets with each period", () => {
    const timed = { ...basketball, clock: { periodSeconds: 600, overtimeSeconds: 300 } };
    const log = eventLog();
    expect(run(timed, log).clock).toEqual({ running: false, seconds: 600, startedAt: null });
    const start = log.clock("start", 600);
    expect(run(timed, log).clock).toEqual({
      running: true,
      seconds: 600,
      startedAt: start.createdAt,
    });
    log.clock("pause", 420);
    expect(run(timed, log).clock).toEqual({ running: false, seconds: 420, startedAt: null });
    log.period(2);
    expect(run(timed, log).clock?.seconds).toBe(600);
    log.period(5);
    expect(run(timed, log).clock?.seconds).toBe(300);
    // Clock events stay off the public timeline.
    expect(run(timed, log).timeline.some((line) => line.text.includes("นาฬิกา"))).toBe(false);
  });
});

test("period labels", () => {
  expect(pointsPeriodLabel(football, 2)).toBe("ครึ่งที่ 2");
  expect(pointsPeriodLabel(basketball, 5)).toBe("ต่อเวลา 1");
  expect(pointsPeriodLabel(threeByThree, 1)).toBe("เกม");
});

test("computeMatchState picks the points engine", () => {
  const log = eventLog();
  log.score("a", 2);
  const state = computeMatchState({
    config: basketball,
    participants: sides("a", "b"),
    events: log.events,
  });
  expect(state.participants[0]?.score).toBe(2);
});
