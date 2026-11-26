// How a match's score reads on staff and public pages: each side's total with
// its breakdown by period, set, end or game, shootouts apart, and race results
// in rank order.
import type {
  MatchStatus,
  ParticipantDetail,
  ParticipantOutcome,
  ScoringConfig,
} from "@it3k/db/competition-rules";
import { RACE_STATUS_LABELS, formatRaceValue } from "@it3k/db/scoring/race";
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

const WINS = new Set<ParticipantOutcome>(["win", "walkover_win"]);

/** Column headings for the breakdown, one per part. */
export function partLabels(scoring: ScoringConfig, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    if (scoring.engine === "points" && n > scoring.periods.count) {
      return `OT${n - scoring.periods.count > 1 ? n - scoring.periods.count : ""}`;
    }
    if (scoring.engine === "race") return `G${n}`;
    return String(n);
  });
}

export function ScoreDisplay({ sides, scoring, status, size = "sm" }: ScoreDisplayProps) {
  if (scoring.engine === "race") return <RaceDisplay sides={sides} scoring={scoring} size={size} />;
  const played = status !== "scheduled" && status !== "checkin";
  const partCount = Math.max(0, ...sides.map((side) => side.detail?.parts?.length ?? 0));
  // One part says nothing a total does not.
  const showParts = partCount > 1;
  const labels = partLabels(scoring, partCount);
  const hasShootout = sides.some((side) => side.detail?.shootout);
  const total = size === "lg" ? "text-4xl" : "text-lg";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-x-1 border-spacing-y-0.5 text-sm">
        {showParts && (
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="text-start font-normal">
                <span className="sr-only">ฝ่าย</span>
              </th>
              {labels.map((label) => (
                <th key={label} scope="col" className="w-7 text-center font-normal tabular-nums">
                  {label}
                </th>
              ))}
              {hasShootout && (
                <th scope="col" className="text-center font-normal">
                  {scoring.engine === "points" ? (scoring.shootout?.label ?? "ยิงโทษ") : ""}
                </th>
              )}
              <th scope="col" className="text-end font-normal">
                {scoring.engine === "sets" || scoring.engine === "series" ? "ชนะ" : "รวม"}
              </th>
            </tr>
          </thead>
        )}
        <tbody>
          {sides.map((side) => {
            const won = side.outcome !== null && WINS.has(side.outcome);
            return (
              <tr key={side.id}>
                <th
                  scope="row"
                  className={cn(
                    "max-w-40 truncate text-start font-normal",
                    won && "font-semibold",
                    size === "lg" && "text-base",
                  )}
                >
                  {side.name}
                </th>
                {showParts &&
                  labels.map((label, i) => (
                    <td key={label} className="text-center text-muted-foreground tabular-nums">
                      {side.detail?.parts?.[i] ?? ""}
                    </td>
                  ))}
                {hasShootout && (
                  <td className="text-center text-muted-foreground tabular-nums">
                    {side.detail?.shootout ? `(${side.detail.shootout.scored})` : ""}
                  </td>
                )}
                <td className={cn("text-end font-semibold tabular-nums", total)}>
                  {played ? (side.score ?? "–") : "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RaceDisplay({
  sides,
  scoring,
  size,
}: {
  sides: ScoreDisplaySide[];
  scoring: Extract<ScoringConfig, { engine: "race" }>;
  size: "sm" | "lg";
}) {
  const ordered = [...sides].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  return (
    <ol className="flex flex-col gap-1">
      {ordered.map((side) => {
        const status = side.detail?.status;
        const result =
          status && status !== "ok"
            ? RACE_STATUS_LABELS[status]
            : side.score !== null
              ? `${side.score} คะแนน`
              : side.resultValue !== null && scoring.measure !== "placement"
                ? formatRaceValue(scoring.measure, side.resultValue)
                : "–";
        return (
          <li key={side.id} className="flex items-center gap-3">
            <span
              className={cn(
                "w-6 text-center font-semibold tabular-nums",
                size === "lg" && "text-2xl",
              )}
            >
              {side.rank ?? "–"}
            </span>
            <span className={cn("min-w-0 flex-1 truncate", side.rank === 1 && "font-semibold")}>
              {side.name}
            </span>
            <span className={cn("font-semibold tabular-nums", size === "lg" ? "text-2xl" : "")}>
              {result}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
