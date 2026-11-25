import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Radio, Tv } from "lucide-react";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { LiveTv } from "@/components/public/live-tv";
import { MatchCard } from "@/components/public/match-card";
import { PublicShell } from "@/components/public/public-shell";
import { useApis } from "@/lib/api-context";
import { type LiveBoard, PUBLIC_COMPETITION_KEY } from "@/lib/public-competition";

/** As often as the edge cache refreshes. */
export const LIVE_POLL_MS = 5_000;

const searchSchema = z.object({
  // ?tv=1: the full-screen board for a screen at the venue.
  tv: z.coerce.number().int().min(0).max(1).optional().catch(undefined),
});

// Public, read signed out.
export const Route = createFileRoute("/live")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({ meta: [{ title: "กำลังแข่ง · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { tv } = Route.useSearch();
  return <LiveView tv={tv === 1} />;
}

export function useLiveBoard() {
  const { publicCompetition: api } = useApis();
  return useQuery({
    queryKey: [...PUBLIC_COMPETITION_KEY, "live"],
    queryFn: () => api.live(),
    refetchInterval: LIVE_POLL_MS,
    // A TV left on all day keeps polling even when nobody touches it.
    refetchIntervalInBackground: true,
  });
}

/** What is on now and what comes next, refreshed every 5 s. */
export function LiveView({ tv }: { tv: boolean }) {
  const board = useLiveBoard();

  if (tv) {
    if (board.data) return <LiveTv board={board.data} />;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950 text-3xl text-white/60">
        {board.isError ? "เชื่อมต่อไม่ได้ กำลังลองใหม่…" : "กำลังโหลด…"}
      </div>
    );
  }

  return (
    <PublicShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader icon={Radio} title="กำลังแข่ง" description="อัปเดตอัตโนมัติทุก 5 วินาที" />
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/live" search={{ tv: 1 }} />}
          nativeButton={false}
        >
          <Tv data-icon="inline-start" aria-hidden />
          โหมดจอทีวี
        </Button>
      </div>
      {board.isPending ? (
        <div role="status" className="grid gap-3 sm:grid-cols-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : board.isError && !board.data ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} title="โหลดผลสดไม่สำเร็จ" />
      ) : (
        <LiveSections board={board.data} />
      )}
    </PublicShell>
  );
}

function MatchGrid({ title, matches }: { title: string; matches: LiveBoard["live"] }) {
  if (matches.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {matches.map((match) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </div>
    </section>
  );
}

export function LiveSections({ board }: { board: LiveBoard }) {
  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      {board.live.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="ยังไม่มีแมตช์ที่กำลังแข่ง"
          description="ดูแมตช์ถัดไปด้านล่าง หรือโปรแกรมทั้งหมด"
          action={
            <Button variant="outline" render={<Link to="/matches" />} nativeButton={false}>
              โปรแกรมและผล
            </Button>
          }
        />
      ) : (
        <MatchGrid title={`กำลังแข่ง ${board.live.length} แมตช์`} matches={board.live} />
      )}
      <MatchGrid title="แมตช์ถัดไป" matches={board.upcoming} />
      <MatchGrid title="ผลล่าสุด" matches={board.recent} />
    </div>
  );
}
