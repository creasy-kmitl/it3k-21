// How a match's score reads on staff and public pages. This first version shows
// each side's total; the scoring stream (B3) adds sets, periods, shootouts and
// race results per engine, keeping these props.
import type {
  MatchStatus,
  ParticipantDetail,
  ParticipantOutcome,
  ScoringConfig,
} from "@it3k/db/competition-rules";
import { cn } from "@it3k/ui/lib/utils";

export type ScoreDisplaySide = {
  id: string;
  name: string;
  score: number | null;
  detail: ParticipantDetail | null;
  resultValue: number | null;
  rank: number | null;
  outcome: ParticipantOutcome | null;
};

export type ScoreDisplayProps = {
  sides: ScoreDisplaySide[];
  scoring: ScoringConfig;
  status: MatchStatus;
  size?: "sm" | "lg";
};

export function ScoreDisplay({ sides, size = "sm" }: ScoreDisplayProps) {
  return (
    <ol className="flex flex-col gap-1">
      {sides.map((side) => (
        <li key={side.id} className="flex items-center justify-between gap-3">
          <span className={cn("truncate", side.outcome === "win" && "font-semibold")}>
            {side.name}
          </span>
          <span
            className={cn("font-semibold tabular-nums", size === "lg" ? "text-4xl" : "text-lg")}
          >
            {side.score ?? "–"}
          </span>
        </li>
      ))}
    </ol>
  );
}
