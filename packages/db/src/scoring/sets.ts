import type { SetsConfig } from "./config";
import type { EngineInput, MatchState } from "./types";

// Placeholder: the scoring stream (B3) replaces this with the real engine and its tests.
export function computeSets(_input: EngineInput<SetsConfig>): MatchState {
  throw new Error("The sets scoring engine is not built yet");
}
