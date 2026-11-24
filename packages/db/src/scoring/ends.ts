import type { EndsConfig } from "./config";
import type { EngineInput, MatchState } from "./types";

// Placeholder: the scoring stream (B3) replaces this with the real engine and its tests.
export function computeEnds(_input: EngineInput<EndsConfig>): MatchState {
  throw new Error("The ends scoring engine is not built yet");
}
