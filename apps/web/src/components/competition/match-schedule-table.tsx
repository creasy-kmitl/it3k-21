import { Clock } from "lucide-react";

import { formatBangkok } from "@/lib/bangkok-time";
import type { PlannedMatchRow } from "@/lib/competition-matches";

/** A planned schedule, one block per time slot, each court on its own row. */
export function MatchScheduleTable({ matches }: { matches: PlannedMatchRow[] }) {
  const slots = new Map<number, PlannedMatchRow[]>();
  for (const match of matches)
    slots.set(match.startAt, [...(slots.get(match.startAt) ?? []), match]);

  return (
    <div className="flex flex-col gap-3">
      {[...slots.entries()].map(([startAt, rows]) => (
        <section
          key={startAt}
          aria-label={`เวลา ${formatBangkok(startAt, "dateTime")}`}
          className="overflow-hidden rounded-2xl border"
        >
          <h3 className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-sm font-medium">
            <Clock className="size-4 text-muted-foreground" aria-hidden />
            {formatBangkok(startAt, "day")} · {formatBangkok(startAt, "time")}
          </h3>
          <ul className="divide-y">
            {rows.map((match) => (
              <li
                key={match.matchNo}
                className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-3 py-2 text-sm sm:grid-cols-[4rem_8rem_1fr_auto]"
              >
                <span className="font-semibold tabular-nums">M{match.matchNo}</span>
                <span className="text-muted-foreground sm:order-none">
                  {[match.venueName, match.court].filter(Boolean).join(" · ") || "ไม่ระบุสนาม"}
                </span>
                <span className="col-span-2 min-w-0 sm:col-span-1">
                  <span className="font-medium">{match.homeName}</span>
                  <span className="px-1.5 text-muted-foreground">พบ</span>
                  <span className="font-medium">{match.awayName}</span>
                </span>
                <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
                  สาย {match.groupName} · นัดที่ {match.roundNo}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
