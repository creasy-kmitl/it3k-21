import type { MatchStatus } from "@it3k/db/match-rules";
import { Badge } from "@it3k/ui/components/badge";

import { STATUS_LABELS } from "@/lib/matches";

/** A match's status as a small badge: red while it is on, grey once it is over. */
export function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge
      variant={status === "live" ? "destructive" : status === "finished" ? "secondary" : "outline"}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}
