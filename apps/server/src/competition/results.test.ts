import { describe, expect, test } from "bun:test";
import { emptyMatchState } from "@it3k/db/scoring/index";

import { createTestContext, defined } from "../testing";
import { loadMatch } from "./access";
import { resultStatements } from "./results";
import { seedMatch } from "./testing";

describe("match results", () => {
  test("loadMatch resolves the division's scoring settings", async () => {
    const t = createTestContext();
    const { match } = await seedMatch(t);
    const loaded = defined(await loadMatch(t.db, match.id));
    expect(loaded.participants.map((p) => p.slot)).toEqual([1, 2]);
    expect(loaded.scoring.engine).toBe("points");
    expect(await loadMatch(t.db, "nope")).toBeNull();
  });

  test("resultStatements caches each side's result and bumps the match", async () => {
    const t = createTestContext();
    const { match, sides } = await seedMatch(t);
    const state = emptyMatchState(sides.map((side) => side.id));
    const [home, away] = state.participants;
    Object.assign(defined(home), { score: 2, rank: 1, outcome: "win", detail: { parts: [1, 1] } });
    Object.assign(defined(away), { score: 0, rank: 2, outcome: "loss", detail: { parts: [0, 0] } });
    const finishedAt = new Date();
    await t.db.batch(
      resultStatements(t.db, {
        matchId: match.id,
        state: { ...state, decided: true },
        status: "finished",
        outcome: "played",
        scoreSeq: 3,
        finishedAt,
      }),
    );

    const loaded = defined(await loadMatch(t.db, match.id));
    expect(loaded).toMatchObject({
      status: "finished",
      outcome: "played",
      scoreSeq: 3,
      version: 2,
      liveState: { decided: true, period: 1, phase: "regular" },
    });
    expect(loaded.participants.map((p) => [p.score, p.rank, p.outcome])).toEqual([
      [2, 1, "win"],
      [0, 2, "loss"],
    ]);
    expect(loaded.participants[0]?.detail).toEqual({ parts: [1, 1] });
  });
});
