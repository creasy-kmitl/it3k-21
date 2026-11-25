import { afterEach, describe, expect, test } from "bun:test";
import type { ScoringConfig } from "@it3k/db/competition-rules";
import { scoringConfigSchema } from "@it3k/db/scoring/config";
import { DIVISION_PRESETS } from "@it3k/db/scoring/presets";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { choose } from "@/test/query";

import { ENGINE_DEFAULTS, ScoringConfigFields, parseNumberList } from "./scoring-config-fields";

afterEach(cleanup);

function Harness({ start, seen }: { start: ScoringConfig; seen: ScoringConfig[] }) {
  const [value, setValue] = useState(start);
  return (
    <ScoringConfigFields
      value={value}
      onChange={(next) => {
        seen.push(next);
        setValue(next);
      }}
    />
  );
}

describe("ScoringConfigFields", () => {
  test("every engine's default is a valid setting", () => {
    for (const make of Object.values(ENGINE_DEFAULTS)) {
      expect(scoringConfigSchema.safeParse(make()).success).toBe(true);
    }
  });

  test("editing the 3x3 final: target 21, lead of 2", () => {
    const seen: ScoringConfig[] = [];
    render(
      <Harness
        start={DIVISION_PRESETS["basketball-3x3-female"]?.scoringConfig as ScoringConfig}
        seen={seen}
      />,
    );
    fireEvent.change(screen.getByLabelText("แต้มที่ชนะทันที"), { target: { value: "21" } });
    fireEvent.change(screen.getByLabelText("ต้องนำอย่างน้อย"), { target: { value: "2" } });
    const last = seen.at(-1);
    expect(last).toMatchObject({ engine: "points", targetScore: 21, targetWinBy: 2 });
    expect(scoringConfigSchema.safeParse(last).success).toBe(true);
  });

  test("switching engine starts from that engine's defaults", async () => {
    const seen: ScoringConfig[] = [];
    render(<Harness start={ENGINE_DEFAULTS.points()} seen={seen} />);
    await choose(screen.getByRole("combobox", { name: "วิธีนับคะแนน" }), "แข่งเป็นเซต");
    expect(seen.at(-1)).toMatchObject({ engine: "sets", pointsPerSet: 15 });
    fireEvent.change(screen.getByLabelText("แต้มสูงสุด"), { target: { value: "" } });
    expect(seen.at(-1)).toMatchObject({ cap: null });
  });

  test("number lists", () => {
    expect(parseNumberList("8, 7 6", 100)).toEqual([8, 7, 6]);
    expect(parseNumberList("8, x", 100)).toBeNull();
    expect(parseNumberList("", 100)).toBeNull();
    expect(parseNumberList("101", 100)).toBeNull();
  });
});
