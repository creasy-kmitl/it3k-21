import type { PointsConfig } from "./config";
import type { EngineInput, MatchState } from "./types";

// Placeholder: the scoring stream (B3) replaces this with the real engine and its tests.
export function computePoints(_input: EngineInput<PointsConfig>): MatchState {
  throw new Error("The points scoring engine is not built yet");
}
