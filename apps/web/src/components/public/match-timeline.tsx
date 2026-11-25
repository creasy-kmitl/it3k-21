import { cn } from "@it3k/ui/lib/utils";

import { formatBangkok } from "@/lib/bangkok-time";
import type { MatchPage } from "@/lib/public-competition";

/** What happened, newest first, each line on the side of the team it belongs to. */
export function MatchTimeline({ match }: { match: Pick<MatchPage, "timeline" | "sides"> }) {
  if (match.timeline.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีเหตุการณ์</p>;
  }
  const slots = new Map(match.sides.map((side, index) => [side.id, index]));
  const names = new Map(match.sides.map((side) => [side.id, side.name]));
  const twoSided = match.sides.length === 2;
  const entries = [...match.timeline].reverse();
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry) => {
        const away = twoSided && entry.sideId !== null && slots.get(entry.sideId) === 1;
        const who = entry.athlete
          ? `${entry.athlete.shirtNumber === null ? "" : `#${entry.athlete.shirtNumber} `}${entry.athlete.name}`
          : null;
        return (
          <li
            key={entry.id}
            className={cn("flex items-center gap-3", away && "flex-row-reverse text-right")}
          >
            <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBangkok(entry.at, "time")}
            </span>
            <div className="flex min-w-0 flex-col rounded-xl bg-muted px-3 py-1.5">
              <span className="font-semibold">{entry.text}</span>
              <span className="truncate text-xs text-muted-foreground">
                {[entry.sideId ? names.get(entry.sideId) : null, who].filter(Boolean).join(" · ")}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
