import { cn } from "@it3k/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { MatchStatusBadge } from "@/components/competition/match-status-badge";
import { ScoreDisplay } from "@/components/competition/score-display";
import type { PublicMatch } from "@/lib/public-competition";

import { periodLabel, placeLabel, roundLabel, scoreSides, timeLabel } from "./match-format";

/** One match in a list: when, what, where, and the score so far. Opens the match page. */
export function MatchCard({ match, className }: { match: PublicMatch; className?: string }) {
  const place = placeLabel(match);
  const period = match.status === "live" ? periodLabel(match) : null;
  return (
    <Link
      to="/matches/$matchId"
      params={{ matchId: match.id }}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        match.status === "live" && "border-destructive/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{match.division.name}</span>
          <span className="truncate text-xs text-muted-foreground">{roundLabel(match)}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <MatchStatusBadge status={match.status} />
          {period && <span className="text-xs text-muted-foreground">{period}</span>}
        </div>
      </div>
      <ScoreDisplay sides={scoreSides(match.sides)} scoring={match.scoring} status={match.status} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{timeLabel(match.startAt)}</span>
        {place && (
          <span className="flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {place}
          </span>
        )}
        {match.friendly && <span>นัดกระชับมิตร</span>}
      </div>
    </Link>
  );
}
