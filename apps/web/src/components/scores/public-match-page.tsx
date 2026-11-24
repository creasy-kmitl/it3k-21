import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { TeamChip } from "@/components/scores/team-chip";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { type PublicMatch, STATUS_LABELS, universityLabel } from "@/lib/matches";

/** How often the scoreboard checks for new scores while it is open. */
export const REFRESH_MS = 15_000;
export const PUBLIC_SCORES_QUERY_KEY = ["public-scores"];

function Team({ match, side }: { match: PublicMatch; side: "A" | "B" }) {
  const team = side === "A" ? match.teamA : match.teamB;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <TeamChip team={team} size="lg" />
      <span className="text-sm font-medium">{universityLabel(team)}</span>
    </div>
  );
}

function Score({ match, side }: { match: PublicMatch; side: "A" | "B" }) {
  const score = side === "A" ? match.scoreA : match.scoreB;
  const name = universityLabel(side === "A" ? match.teamA : match.teamB);
  return (
    <output
      aria-label={`คะแนน ${name}`}
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

function PublicMatch({ match }: { match: PublicMatch }) {
  const live = match.status === "live";
  const stopped = live && match.pausedAt !== null;
  return (
    <section
      aria-label={`คะแนน ${match.sport}`}
      className="flex flex-col gap-10 rounded-3xl border bg-card p-5 shadow-sm sm:p-10"
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
        <Team match={match} side="A" />
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="m-0 text-xs font-semibold tracking-[0.2em] text-primary uppercase">กีฬา</p>
          <h1 className="m-0 text-2xl font-bold tracking-tight sm:text-3xl">{match.sport}</h1>
          <p className="m-0 text-sm text-muted-foreground">
            {[match.division, match.round, match.startsAt && formatBangkok(match.startsAt, "dateTime")]
              .filter(Boolean)
              .join(" · ")}
          </p>
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
        </div>
        <Team match={match} side="B" />
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <Score match={match} side="A" />
        <span aria-hidden className="text-4xl font-light text-muted-foreground sm:text-6xl">
          :
        </span>
        <Score match={match} side="B" />
      </div>
    </section>
  );
}
