import { MATCH_OUTCOME_LABELS } from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@it3k/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Clock, MapPin, Whistle } from "lucide-react";

import { MatchStatusBadge } from "@/components/competition/match-status-badge";
import { ScoreDisplay } from "@/components/competition/score-display";
import { ErrorState } from "@/components/error-state";
import { MarkdownView } from "@/components/markdown-view";
import { MatchCard } from "@/components/public/match-card";
import {
  periodLabel,
  placeLabel,
  roundLabel,
  scoreSides,
  sidesLabel,
} from "@/components/public/match-format";
import { MatchTimeline } from "@/components/public/match-timeline";
import { PublicShell } from "@/components/public/public-shell";
import { TeamRoster } from "@/components/public/team-roster";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { ApiError } from "@/lib/leadership";
import { type MatchPage, PUBLIC_COMPETITION_KEY } from "@/lib/public-competition";

// Public, read signed out.
export const Route = createFileRoute("/matches_/$matchId")({
  head: () => ({ meta: [{ title: "ผลการแข่งขัน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { matchId } = Route.useParams();
  return (
    <PublicShell>
      <MatchView matchId={matchId} />
    </PublicShell>
  );
}

/** A live match polls every 5 s; others refresh now and then in case they start. */
export function MatchView({ matchId }: { matchId: string }) {
  const { publicCompetition: api } = useApis();
  const query = useQuery({
    queryKey: [...PUBLIC_COMPETITION_KEY, "match", matchId],
    queryFn: () => api.match(matchId),
    refetchInterval: (q) => (q.state.data?.status === "live" ? 5_000 : 60_000),
  });

  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="self-start"
      render={<Link to="/matches" />}
      nativeButton={false}
    >
      <ArrowLeft data-icon="inline-start" aria-hidden />
      โปรแกรมและผล
    </Button>
  );

  if (query.isPending) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">กำลังโหลด</span>
        {back}
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        {back}
        <ErrorState
          error={query.error}
          onRetry={missing ? undefined : () => query.refetch()}
          title={missing ? "ไม่พบแมตช์นี้" : "โหลดแมตช์ไม่สำเร็จ"}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {back}
      <MatchDetail match={query.data} />
    </div>
  );
}

export function MatchDetail({ match }: { match: MatchPage }) {
  const place = placeLabel(match);
  const period = match.status === "live" ? periodLabel(match) : null;
  const cover = match.coverImageUrl ?? match.images.find((image) => image.isCover)?.url ?? null;
  const hasRoster = match.sides.some(
    (side) => side.members.length > 0 || side.officials.length > 0,
  );

  return (
    <article className="flex flex-col gap-5">
      {cover && (
        <img
          src={cover}
          alt=""
          className="aspect-[21/9] w-full rounded-2xl border object-cover"
          loading="lazy"
        />
      )}
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {match.sport.name} · {roundLabel(match)}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{match.division.name}</h1>
        <p className="text-muted-foreground">{sidesLabel(match.sides)}</p>
      </header>

      <section
        aria-label="สกอร์"
        className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-2">
          <MatchStatusBadge status={match.status} />
          {period && <span className="text-sm font-medium">{period}</span>}
          {match.status === "finished" && match.outcome && match.outcome !== "played" && (
            <span className="text-sm text-muted-foreground">
              {MATCH_OUTCOME_LABELS[match.outcome]}
            </span>
          )}
          {match.friendly && <span className="text-sm text-muted-foreground">นัดกระชับมิตร</span>}
        </div>
        <ScoreDisplay
          sides={scoreSides(match.sides)}
          scoring={match.scoring}
          status={match.status}
          size="lg"
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {match.startAt !== null && (
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" aria-hidden />
              {formatBangkok(match.startAt, "date")} {formatBangkok(match.startAt, "time")}
            </span>
          )}
          {place && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden />
              {place}
            </span>
          )}
        </div>
        {match.referees.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-sm">
            <Whistle className="size-4 text-muted-foreground" aria-label="กรรมการ" />
            {match.referees.map((referee, index) => (
              <span key={`${referee.name}-${index}`}>
                <span className="text-muted-foreground">{referee.role}</span> {referee.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {match.subMatches.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">แมตช์ย่อย</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {match.subMatches.map((sub) => (
              <MatchCard key={sub.id} match={sub} />
            ))}
          </div>
        </section>
      )}

      <Tabs defaultValue={match.timeline.length > 0 ? "timeline" : hasRoster ? "teams" : "rules"}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="timeline">ไทม์ไลน์</TabsTrigger>
          <TabsTrigger value="teams">รายชื่อ</TabsTrigger>
          <TabsTrigger value="rules">กติกา</TabsTrigger>
          {match.images.length > 0 && <TabsTrigger value="images">รูปภาพ</TabsTrigger>}
        </TabsList>
        <TabsContent value="timeline" className="pt-2">
          <MatchTimeline match={match} />
        </TabsContent>
        <TabsContent value="teams" className="pt-2">
          {match.sides.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีรายชื่อ</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {match.sides.map((side) => (
                <TeamRoster key={side.id} side={side} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="rules" className="pt-2">
          {match.rules ? (
            <MarkdownView markdown={match.rules} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีกติกาของประเภทนี้</p>
          )}
        </TabsContent>
        {match.images.length > 0 && (
          <TabsContent value="images" className="pt-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {match.images.map((image) => (
                <figure key={image.id} className="flex flex-col gap-1">
                  <a href={image.url} target="_blank" rel="noreferrer noopener">
                    <img
                      src={image.url}
                      alt={image.caption ?? ""}
                      loading="lazy"
                      className="aspect-square w-full rounded-xl border object-cover"
                    />
                  </a>
                  {image.caption && (
                    <figcaption className="text-xs text-muted-foreground">
                      {image.caption}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </article>
  );
}
