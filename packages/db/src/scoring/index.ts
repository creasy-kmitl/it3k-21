// Works out a match's state from its events with the engine its settings name.
// Each engine is a pure function, so the server, the scorer's phone and the
// tests all get the same answer from the same events.
import type { ScoringConfig } from "./config";
import { computeEnds } from "./ends";
import { computePoints } from "./points";
import { computeRace } from "./race";
import { computeSeries } from "./series";
import { computeSets } from "./sets";
import type { EngineInput, MatchState } from "./types";

export function computeMatchState(input: EngineInput<ScoringConfig>): MatchState {
  const { config } = input;
  switch (config.engine) {
    case "points":
      return computePoints({ ...input, config });
    case "sets":
      return computeSets({ ...input, config });
    case "series":
      return computeSeries({ ...input, config });
    case "ends":
      return computeEnds({ ...input, config });
    case "race":
      return computeRace({ ...input, config });
  }
}

/** A state with no events yet: every side on nothing, nobody ranked. */
export function emptyMatchState(participantIds: string[]): MatchState {
  return {
    participants: participantIds.map((participantId) => ({
      participantId,
      score: null,
      detail: null,
      resultValue: null,
      rank: null,
      outcome: null,
    })),
    period: 1,
    phase: "regular",
    decided: false,
    clock: null,
    timeline: [],
  };
}
