import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Clock, Trophy } from "lucide-react";

import { TeamChip } from "@/components/scores/team-chip";
import { formatBangkok } from "@/lib/bangkok-time";
import { type PublicMatch, universityLabel } from "@/lib/matches";

function TeamLine({ match, side }: { match: PublicMatch; side: "A" | "B" }) {
  const team = side === "A" ? match.teamA : match.teamB;
  const score = side === "A" ? match.scoreA : match.scoreB;
  return (
    <div className="flex items-center gap-3">
      <TeamChip team={team} />
      <span className="flex-1 font-medium">{universityLabel(team)}</span>
      <span className="text-3xl font-bold tabular-nums">{score ?? "–"}</span>
    </div>
  );
}

/** One match in the public list; the whole card opens its score page. */
export function MatchCard({ match }: { match: PublicMatch }) {
  const name = `${match.sport} ${universityLabel(match.teamA)} พบ ${universityLabel(match.teamB)}`;
  return (
    <li>
      <Link
        to="/scores/$matchId"
        params={{ matchId: match.id }}
        aria-label={`ดูคะแนน ${name}`}
        className="group flex h-full flex-col rounded-2xl border bg-card transition hover:border-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
      >
        <div className="flex items-center gap-2 border-b px-5 py-4 font-medium">
          <Trophy className="size-4 shrink-0" />
          <span className="truncate">{match.sport}</span>
          {match.division && (
            <span className="truncate text-sm font-normal text-muted-foreground">
              · {match.division}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <TeamLine match={match} side="A" />
          <TeamLine match={match} side="B" />
        </div>

        <div className="mt-auto flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {match.startsAt ? formatBangkok(match.startsAt, "time") : "ยังไม่กำหนดเวลา"}
            {match.round && ` · ${match.round}`}
          </span>
          <ArrowUpRight className="size-4" />
        </div>
      </Link>
    </li>
  );
}
