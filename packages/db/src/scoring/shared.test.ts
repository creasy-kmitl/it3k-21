import { describe, expect, test } from "bun:test";

import type { ScoringConfig } from "./config";
import { DIVISION_PRESETS } from "./presets";
import { eventProblem, outcomeFor, rankBy } from "./shared";

const preset = (code: string) => DIVISION_PRESETS[code]?.scoringConfig as ScoringConfig;
const sides = ["a", "b"];

describe("eventProblem", () => {
  test("each engine takes only its own events, for the match's sides", () => {
    const basketball = preset("basketball-5x5-male");
    expect(
      eventProblem(
        basketball,
        { type: "score", participantId: "a", points: 3, registrationId: null },
        sides,
      ),
    ).toBeNull();
    expect(
      eventProblem(
        basketball,
        { type: "score", participantId: "a", points: 4, registrationId: null },
        sides,
      ),
    ).not.toBeNull();
    expect(
      eventProblem(
        basketball,
        { type: "score", participantId: "z", points: 1, registrationId: null },
        sides,
      ),
    ).not.toBeNull();
    expect(eventProblem(basketball, { type: "game", participantId: "a" }, sides)).not.toBeNull();
    // 5x5 basketball has no shootout; chairball does.
    expect(
      eventProblem(basketball, { type: "shootout", participantId: "a", scored: true }, sides),
    ).not.toBeNull();
    expect(
      eventProblem(
        preset("chairball-male"),
        { type: "shootout", participantId: "a", scored: true },
        sides,
      ),
    ).toBeNull();
    expect(
      eventProblem(
        preset("badminton-singles-male"),
        { type: "score", participantId: "a", points: 2, registrationId: null },
        sides,
      ),
    ).not.toBeNull();
    expect(
      eventProblem(
        preset("petanque-male"),
        { type: "score", participantId: "a", points: 7, registrationId: null },
        sides,
      ),
    ).not.toBeNull();
    expect(
      eventProblem(
        preset("athletics-100m-male"),
        { type: "result", participantId: "a", value: null, status: "ok" },
        sides,
      ),
    ).not.toBeNull();
    expect(
      eventProblem(
        preset("athletics-100m-male"),
        { type: "result", participantId: "a", value: null, status: "dnf" },
        sides,
      ),
    ).toBeNull();
    expect(
      eventProblem(
        preset("esports-tft"),
        { type: "placement", participantId: "a", registrationId: null, game: 2, place: 1 },
        sides,
      ),
    ).not.toBeNull();
    expect(
      eventProblem(
        preset("esports-tft"),
        { type: "result", participantId: "a", value: 1, status: "ok" },
        sides,
      ),
    ).not.toBeNull();
    expect(
      eventProblem(preset("football"), { type: "clock", action: "start", seconds: 600 }, sides),
    ).toBeNull();
  });
});

test("ranks and outcomes", () => {
  const ranks = rankBy([5, 9, 5, 1], (a, b) => b - a);
  expect([...ranks.entries()]).toEqual([
    [9, 1],
    [5, 2],
    [1, 4],
  ]);
  expect(outcomeFor(1, [1, 2])).toBe("win");
  expect(outcomeFor(1, [1, 1])).toBe("draw");
  expect(outcomeFor(null, [1, null])).toBe("loss");
});
