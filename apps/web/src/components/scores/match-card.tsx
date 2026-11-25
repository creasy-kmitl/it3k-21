import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Clock, Trophy } from "lucide-react";

import { MultiBody } from "@/components/scores/ranking-list";
import { StatusBadge } from "@/components/scores/status-badge";
import { SetsCardBody } from "@/components/scores/sets-board";
import { TeamChip } from "@/components/scores/team-chip";
import { WinnerMark } from "@/components/scores/winner-mark";
import { formatBangkok } from "@/lib/bangkok-time";
import { type PublicMatch, sidesOf, universityLabel } from "@/lib/matches";

function TeamLine({ match, side }: { match: PublicMatch; side: "A" | "B" }) {
  const sides = sidesOf(match);
  if (!sides) return null;
  const team = side === "A" ? sides.a : sides.b;
  const score = side === "A" ? match.scoreA : match.scoreB;
  return (
    <div className="flex items-center gap-3">
      <TeamChip team={team} />
      <span className="flex-1 font-medium">{universityLabel(team)}</span>
      {match.scoring === "after" ? (
        match.status === "finished" && match.winner === team ? <WinnerMark /> : null
      ) : (
        <span className="text-3xl font-bold tabular-nums">{score ?? "–"}</span>
      )}
    </div>
  );
}

/** One match in the public list; the whole card opens its score page. */
export function MatchCard({ match }: { match: PublicMatch }) {
  const sides = sidesOf(match);
  const name = sides
    ? `${match.sport} ${universityLabel(sides.a)} พบ ${universityLabel(sides.b)}`
    : match.sport;
  return (
    <li>
      <Link
        to="/scores/$matchId"
        params={{ matchId: match.id }}
        aria-label={`ดูคะแนน ${name}`}
        className="group flex h-full flex-col rounded-2xl border bg-card transition hover:border-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
      >
        <div className="flex items-center justify-between gap-2 border-b px-5 py-4 font-medium">
          <span className="flex min-w-0 items-center gap-2">
            <Trophy className="size-4 shrink-0" />
            {/* The list is grouped under the sport, so the card names the division instead. */}
            <span className="truncate">{match.division ?? match.sport}</span>
          </span>
          <StatusBadge status={match.status} />
        </div>

        <div
          className={`flex flex-1 flex-col justify-center gap-3 px-5 py-4 ${sides ? "" : "min-h-44"}`}
        >
          {sides && match.scoring === "sets" ? (
            <SetsCardBody
              a={sides.a}
              b={sides.b}
              sets={match.sets}
              setsToWin={match.setsToWin}
              scoreA={match.scoreA}
              scoreB={match.scoreB}
            />
          ) : sides ? (
            <>
              <TeamLine match={match} side="A" />
              <TeamLine match={match} side="B" />
            </>
          ) : (
            <MultiBody status={match.status} ranking={match.ranking} />
          )}
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
