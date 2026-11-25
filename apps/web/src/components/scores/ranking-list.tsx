import type { MatchStatus, University } from "@it3k/db/match-rules";

import { TeamChip } from "@/components/scores/team-chip";
import { universityLabel } from "@/lib/matches";

/** The places of a match with many teams, best first; the winner's row stands out. */
export function RankingList({ ranking }: { ranking: University[] }) {
  return (
    <ol className="m-0 flex w-full list-none flex-col gap-3 p-0">
      {ranking.map((team, index) => (
        <li
          key={`${index}-${team}`}
          className="flex items-center gap-3 rounded-2xl border px-4 py-3 first:border-primary/40 first:bg-primary/5"
        >
          <span className="w-8 text-center text-3xl font-bold tabular-nums">{index + 1}</span>
          <TeamChip team={team} size="lg" />
          <span className="text-lg font-semibold">{universityLabel(team)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The places as plain rows, number first, the way a card in a list shows them. */
export function RankingRows({ ranking }: { ranking: University[] }) {
  return (
    <>
      {ranking.map((team, index) => (
        <div key={`${index}-${team}`} className="flex items-center gap-3">
          <span className="w-6 text-center text-3xl font-bold tabular-nums">{index + 1}</span>
          <TeamChip team={team} />
          <span className="flex-1 font-medium">{universityLabel(team)}</span>
        </div>
      ))}
    </>
  );
}

/**
 * The middle of a list card for a match with many teams: the places once it is
 * over, until then a note that they are coming. The card's badge shows the status.
 */
export function MultiBody({ status, ranking }: { status: MatchStatus; ranking: University[] }) {
  if (status === "finished" && ranking.length > 0) return <RankingRows ranking={ranking} />;
  return (
    <p className="m-0 py-4 text-center text-sm text-muted-foreground">
      {status === "finished" ? "ยังไม่ได้บันทึกผลการแข่งขัน" : "ประกาศผลหลังสิ้นสุดการแข่งขัน"}
    </p>
  );
}
