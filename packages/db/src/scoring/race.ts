import type { RaceConfig } from "./config";
import type { EngineInput, MatchState } from "./types";

// Placeholder: the scoring stream (B3) replaces this with the real engine and its tests.
export function computeRace(_input: EngineInput<RaceConfig>): MatchState {
  throw new Error("The race scoring engine is not built yet");
}
