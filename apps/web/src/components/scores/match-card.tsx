import { cn } from "@it3k/ui/lib/utils";
import { ArrowUpRight, Clock, Trophy } from "lucide-react";

import { TeamChip } from "@/components/scores/team-chip";
import { formatBangkok } from "@/lib/bangkok-time";
import { type PublicMatch, universityLabel } from "@/lib/matches";

export function MatchCard({ match }: { match: PublicMatch }) {
  return (
    <li className="flex flex-col rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b px-5 py-4 font-medium">
        <Trophy className="size-4" />
        {match.sport}
      </div>

      {/* ส่วนกลาง: 2 ทีม */}
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
            <TeamChip team={match.teamA} />
            <span className="flex-1 font-medium">{universityLabel(match.teamA)}</span>
            <span className="text-3xl font-bold tabular-nums">{match.scoreA ?? "–"}</span>
        </div>
        <div className="flex items-center gap-3">
            <TeamChip team={match.teamB} />
            <span className="flex-1 font-medium">{universityLabel(match.teamB)}</span>
            <span className="text-3xl font-bold tabular-nums">{match.scoreB ?? "–"}</span>
        </div>
      </div>

      {/* ส่วนท้าย: เวลา + รอบ */}
      <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" />
                {match.startsAt ? formatBangkok(match.startsAt, "time") : "ยังไม่กำหนดเวลา"}
                {match.round && ` · ${match.round}`}
            </span>
        <ArrowUpRight className="size-4" />

      </div>
    </li>
  );
}
