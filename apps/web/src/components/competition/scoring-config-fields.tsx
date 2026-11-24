// Placeholder with the props the division settings form passes. The scoring
// stream (B3) builds the fields for each engine's settings.
import type { ScoringConfig } from "@it3k/db/competition-rules";

export type ScoringConfigFieldsProps = {
  value: ScoringConfig;
  onChange: (value: ScoringConfig) => void;
  disabled?: boolean;
};

export function ScoringConfigFields(_props: ScoringConfigFieldsProps) {
  return null;
}
