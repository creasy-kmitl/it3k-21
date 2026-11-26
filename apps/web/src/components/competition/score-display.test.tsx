import { afterEach, describe, expect, test } from "bun:test";
import type { ScoringConfig } from "@it3k/db/competition-rules";
import { DIVISION_PRESETS } from "@it3k/db/scoring/presets";
import { cleanup, render, screen, within } from "@testing-library/react";

import { type ScoreDisplaySide, ScoreDisplay, partLabels } from "./score-display";

afterEach(cleanup);

const preset = (code: string) => DIVISION_PRESETS[code]?.scoringConfig as ScoringConfig;
const side = (id: string, overrides: Partial<ScoreDisplaySide>): ScoreDisplaySide => ({
  id,
  name: id,
  score: null,
  detail: null,
  resultValue: null,
  rank: null,
  outcome: null,
  ...overrides,
});

describe("ScoreDisplay", () => {
  test("sets show points per set and sets won", () => {
    render(
      <ScoreDisplay
        scoring={preset("badminton-singles-male")}
        status="finished"
        sides={[
          side("สจล.", { score: 2, detail: { parts: [15, 12, 15], won: 2 }, outcome: "win" }),
          side("มจธ.", { score: 1, detail: { parts: [10, 15, 9], won: 1 }, outcome: "loss" }),
        ]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "ชนะ" })).toBeTruthy();
    const row = screen.getByRole("row", { name: /สจล\./ });
    expect(
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["15", "12", "15", "2"]);
  });

  test("a shootout shows apart from the score", () => {
    render(
      <ScoreDisplay
        scoring={preset("chairball-male")}
        status="finished"
        sides={[
          side("a", { score: 2, detail: { parts: [1, 1, 0], shootout: { scored: 4, taken: 5 } } }),
          side("b", { score: 2, detail: { parts: [2, 0, 0], shootout: { scored: 3, taken: 5 } } }),
        ]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "ยิงโทษ" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "OT" })).toBeTruthy();
    expect(screen.getByText("(4)")).toBeTruthy();
  });

  test("a match not started shows dashes", () => {
    render(
      <ScoreDisplay
        scoring={preset("football")}
        status="scheduled"
        sides={[side("a", {}), side("b", {})]}
      />,
    );
    expect(screen.getAllByText("–")).toHaveLength(2);
  });

  test("races list sides by rank with their time or status", () => {
    render(
      <ScoreDisplay
        scoring={preset("athletics-100m-male")}
        status="finished"
        sides={[
          side("ช้า", { rank: 2, resultValue: 11_420, detail: { status: "ok" } }),
          side("ตัดสิทธิ์", { detail: { status: "dq" } }),
          side("เร็ว", { rank: 1, resultValue: 10_980, detail: { status: "ok" } }),
        ]}
      />,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1เร็ว10.98 วิ",
      "2ช้า11.42 วิ",
      "–ตัดสิทธิ์ถูกตัดสิทธิ์ (DQ)",
    ]);
  });

  test("part labels", () => {
    expect(partLabels(preset("basketball-5x5-male"), 6)).toEqual(["1", "2", "3", "4", "OT", "OT2"]);
  });
});
