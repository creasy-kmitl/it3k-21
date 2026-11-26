import { MATCH_STATUS_LABELS, type MatchStatus } from "@it3k/db/competition-rules";
import { Badge } from "@it3k/ui/components/badge";

const VARIANTS: Record<MatchStatus, "default" | "secondary" | "destructive" | "outline"> = {
  scheduled: "outline",
  checkin: "secondary",
  live: "destructive",
  finished: "secondary",
  postponed: "outline",
  cancelled: "outline",
};

/** A colour per status, for the dots in status filters. */
export const MATCH_STATUS_DOT: Record<MatchStatus, string> = {
  scheduled: "bg-sky-500",
  checkin: "bg-amber-500",
  live: "bg-destructive",
  finished: "bg-success",
  postponed: "bg-orange-400",
  cancelled: "bg-muted-foreground",
};

/** A match's status as a badge; a live match gets a pulsing dot. */
export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge variant={VARIANTS[status]}>
      {status === "live" && (
        <span
          className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
          aria-hidden
        />
      )}
      {MATCH_STATUS_LABELS[status]}
    </Badge>
  );
}
