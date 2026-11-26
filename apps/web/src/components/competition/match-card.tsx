import { cn } from "@it3k/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { InstitutionLogo } from "@/components/institution-logo";
import { SportMark } from "@/components/sport-art";
import { formatBangkok } from "@/lib/bangkok-time";
import type { MatchListItem } from "@/lib/competition-matches";

import { MatchStatusBadge } from "./match-status-badge";

/** Where and what a match is, e.g. "M12 · รอบแบ่งกลุ่ม · สาย A". */
export function matchHeading(match: {
  matchNo: number | null;
  stageName: string;
  groupName: string | null;
  roundNo?: number | null;
}) {
  return [
    match.matchNo !== null ? `M${match.matchNo}` : null,
    match.stageName,
    match.groupName ? `สาย ${match.groupName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "สนามกลาง · คอร์ต 1", or null when the match has neither. */
export function matchPlace(match: { venueName: string | null; court: string | null }) {
  const parts = [match.venueName, match.court ? `คอร์ต ${match.court}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** One match in a day's list: its time, sides and status, opening its page. */
export function MatchCard({ match }: { match: MatchListItem }) {
  const place = matchPlace(match);
  const showScore = match.status === "live" || match.status === "finished";
  return (
    <Link
      to="/staff/matches/$matchId"
      params={{ matchId: match.id }}
      className="flex gap-3 rounded-2xl border bg-card p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 pt-0.5 text-center">
        <span className="font-semibold tabular-nums">
          {match.startAt !== null ? formatBangkok(match.startAt, "time") : "–"}
        </span>
        <SportMark icon={match.sportIcon} seed={match.sportId} className="size-8 rounded-lg" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {match.sportName} · {match.divisionName}
          </span>
          <span>{matchHeading(match)}</span>
          {match.friendly && <span>(กระชับมิตร)</span>}
        </div>
        <ol className="flex flex-col gap-0.5">
          {match.participants.map((side) => (
            <li key={side.id} className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "flex min-w-0 items-center gap-2 truncate",
                  side.teamId === null && "text-muted-foreground italic",
                  side.outcome === "win" && "font-semibold",
                )}
              >
                {side.institution ? (
                  <InstitutionLogo institution={side.institution} />
                ) : (
                  <span aria-hidden className="size-4 shrink-0 rounded-full border border-dashed" />
                )}
                <span className="truncate">{side.name}</span>
              </span>
              {showScore && <span className="font-semibold tabular-nums">{side.score ?? "–"}</span>}
            </li>
          ))}
        </ol>
        {place && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden /> {place}
          </span>
        )}
      </div>
      <div className="shrink-0">
        <MatchStatusBadge status={match.status} />
      </div>
    </Link>
  );
}
