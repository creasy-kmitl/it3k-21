import type { SeriesConfig } from "./config";
import type { EngineInput, MatchState } from "./types";

// Placeholder: the scoring stream (B3) replaces this with the real engine and its tests.
export function computeSeries(_input: EngineInput<SeriesConfig>): MatchState {
  throw new Error("The series scoring engine is not built yet");
}
