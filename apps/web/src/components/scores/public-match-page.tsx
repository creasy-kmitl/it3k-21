import type { University } from "@it3k/db/match-rules";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { RankingList } from "@/components/scores/ranking-list";
import { SetsBoard } from "@/components/scores/sets-board";
import { TeamChip } from "@/components/scores/team-chip";
import { WinnerMark } from "@/components/scores/winner-mark";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { type PublicMatch, STATUS_LABELS, sidesOf, universityLabel } from "@/lib/matches";

/** How often the scoreboard checks for new scores while it is open. */
export const REFRESH_MS = 5_000;
export const PUBLIC_SCORES_QUERY_KEY = ["public-scores"];

function Team({ team, won = false }: { team: University; won?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <TeamChip team={team} size="lg" />
      <span className="text-sm font-medium">{universityLabel(team)}</span>
      {won && <WinnerMark />}
    </div>
  );
}

function Score({ team, score }: { team: University; score: number | null }) {
  return (
    <output
      aria-label={`คะแนน ${universityLabel(team)}`}
      className="text-center text-8xl font-bold tabular-nums sm:text-9xl"
    >
      {score ?? "–"}
    </output>
  );
}

/** One match as the audience sees it: the teams, its state and the scores, nothing to press. */
export function PublicMatchPage({ matchId }: { matchId: string }) {
  const { publicScores } = useApis();
  const board = useQuery({
    queryKey: PUBLIC_SCORES_QUERY_KEY,
    queryFn: () => publicScores.get(),
    refetchInterval: REFRESH_MS,
  });
  const match = board.data?.matches.find((item) => item.id === matchId);

  const back = (
    <Link
      to="/scores"
      className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4" />
      กลับไปหน้าคะแนน
    </Link>
  );

  return (
    <div className="container mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      {back}
      {board.isPending ? (
        <Skeleton className="h-96 rounded-3xl" />
      ) : board.isError ? (
        <p className="text-destructive">โหลดคะแนนไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>
      ) : !match ? (
        <p className="text-muted-foreground">ไม่พบแมตช์นี้ อาจถูกลบไปแล้ว</p>
      ) : (
        <PublicMatch match={match} />
      )}
    </div>
  );
}

function StatusPill({ match }: { match: PublicMatch }) {
  const live = match.status === "live";
  const stopped = live && match.pausedAt !== null;
  return (
    <span
      className={cn(
        "mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
        stopped
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : live
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
    >
      {live && !stopped && <span className="size-2 animate-pulse rounded-full bg-current" />}
      {stopped ? "หยุดชั่วคราว" : STATUS_LABELS[match.status]}
    </span>
  );
}

function Heading({ match }: { match: PublicMatch }) {
  return (
    <>
      <p className="m-0 text-xs font-semibold tracking-[0.2em] text-primary uppercase">กีฬา</p>
      <h1 className="m-0 text-2xl font-bold tracking-tight sm:text-3xl">{match.sport}</h1>
      <p className="m-0 text-sm text-muted-foreground">
        {[match.division, match.round, match.startsAt && formatBangkok(match.startsAt, "dateTime")]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <StatusPill match={match} />
    </>
  );
}

function PublicMatch({ match }: { match: PublicMatch }) {
  const sides = sidesOf(match);
  if (!sides) {
    // Many teams, laid out like the staff's control page: the heading and status, then the places.
    return (
      <section
        aria-label={`ผล ${match.sport}`}
        className="flex flex-col gap-8 rounded-3xl border bg-card p-5 shadow-sm sm:p-10"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Heading match={match} />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 text-center">
          {match.status === "finished" && match.ranking.length > 0 ? (
            <>
              <p className="m-0 font-medium">ผลการแข่งขัน</p>
              <RankingList ranking={match.ranking} />
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">
              ประกาศผลการแข่งขันหลังสิ้นสุดการแข่งขัน
            </p>
          )}
        </div>
      </section>
    );
  }
  const card = "flex flex-col gap-10 rounded-3xl border bg-card p-5 shadow-sm sm:p-10";
  // Who won a match reported only by its winner, once it is over.
  const wins = match.scoring === "after" && match.status === "finished" ? match.winner : null;
  if (match.scoring === "sets") {
    // A series of sets: the board has both teams, so none are shown in the corners.
    return (
      <section aria-label={`คะแนน ${match.sport}`} className={card}>
        <div className="flex flex-col items-center gap-2 text-center">
          <Heading match={match} />
        </div>
        <SetsBoard a={sides.a} b={sides.b} sets={match.sets} setsToWin={match.setsToWin} />
      </section>
    );
  }
  return (
    <section aria-label={`คะแนน ${match.sport}`} className={card}>
      <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
        <Team team={sides.a} won={wins === sides.a} />
        <div className="flex flex-col items-center gap-2 text-center">
          <Heading match={match} />
        </div>
        <Team team={sides.b} won={wins === sides.b} />
      </div>

      {match.scoring === "after" ? (
        // The winner is marked under its own team, so only the wait needs a line of its own.
        wins === null && (
          <p className="m-0 text-center text-muted-foreground">
            ประกาศผลการแข่งขันหลังสิ้นสุดการแข่งขัน
          </p>
        )
      ) : (

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Score team={sides.a} score={match.scoreA} />
          <span aria-hidden className="text-4xl font-light text-muted-foreground sm:text-6xl">
            :
          </span>
          <Score team={sides.b} score={match.scoreB} />
        </div>
      )}
    </section>
  );
}
