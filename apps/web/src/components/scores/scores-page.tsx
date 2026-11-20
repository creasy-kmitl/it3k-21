import type { MatchStatus } from "@it3k/db/match-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@it3k/ui/components/empty";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Clock, ExternalLink, Plus, Trophy } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { TeamChip } from "@/components/scores/team-chip";
import { type Segment, SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { type Match, STATUS_LABELS, universityLabel } from "@/lib/matches";

export const MATCHES_QUERY_KEY = ["matches"];

type Filter = MatchStatus | "all";

const FILTERS: Segment<Filter>[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "live", label: STATUS_LABELS.live },
  { value: "scheduled", label: STATUS_LABELS.scheduled },
  { value: "finished", label: STATUS_LABELS.finished },
];

export function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge
      variant={status === "live" ? "destructive" : status === "finished" ? "secondary" : "outline"}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function TeamLine({ match, side }: { match: Match; side: "A" | "B" }) {
  const team = side === "A" ? match.teamA : match.teamB;
  const score = side === "A" ? match.scoreA : match.scoreB;
  const name = universityLabel(team);
  return (
    <div className="flex items-center gap-3">
      <TeamChip team={team} />
      <span className="flex-1 font-medium">{name}</span>
      <output className="text-3xl font-bold tabular-nums" aria-label={`คะแนน ${name}`}>
        {score ?? "–"}
      </output>
    </div>
  );
}

/** One match in the list; the whole card opens its control page. */
function MatchRow({ match }: { match: Match }) {
  const name = `${match.sport} ${universityLabel(match.teamA)} พบ ${universityLabel(match.teamB)}`;
  return (
    <li>
      <Link
        to="/staff/scores/$matchId"
        params={{ matchId: match.id }}
        aria-label={`เปิดแมตช์ ${name}`}
        className="group flex h-full flex-col rounded-2xl border bg-card transition hover:border-primary hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
      >
        <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <Trophy aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="truncate">{match.sport}</span>
            {match.round && (
              <span className="truncate text-sm font-normal text-muted-foreground">
                · {match.round}
              </span>
            )}
          </span>
          <StatusBadge status={match.status} />
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <TeamLine match={match} side="A" />
          <TeamLine match={match} side="B" />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5" />
            {match.startsAt ? formatBangkok(match.startsAt, "dateTime") : "ยังไม่กำหนดเวลา"}
            {match.durationMinutes && ` · ${match.durationMinutes} นาที`}
          </span>
          <ChevronRight
            aria-hidden
            className="size-4 transition group-hover:translate-x-0.5 group-hover:text-primary"
          />
        </div>
      </Link>
    </li>
  );
}

/** Every match, soonest first; staff open one to run its score. */
export function ScoresPage() {
  const { matches } = useApis();
  const [filter, setFilter] = useState<Filter>("all");

  const list = useQuery({ queryKey: MATCHES_QUERY_KEY, queryFn: () => matches.list() });
  const items = list.data?.items ?? [];
  const shown = filter === "all" ? items : items.filter((item) => item.status === filter);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        icon={Trophy}
        title="คะแนนการแข่งขัน"
        description={
          <>
            กดแมตช์เพื่อคุมคะแนนและเวลา ตารางคะแนนรวมคำนวณจากแมตช์ที่จบแล้ว{" "}
            <Link
              to="/scores"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              ดูหน้าสาธารณะ
              <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          label="สถานะแมตช์"
          segments={FILTERS}
          value={filter}
          onChange={setFilter}
        />
        <Button render={<Link to="/staff/scores/new" />} nativeButton={false}>
          <Plus data-icon="inline-start" />
          เพิ่มแมตช์
        </Button>
      </div>

      {list.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : list.isError ? (
        <p className="text-destructive">โหลดแมตช์ไม่สำเร็จ: {list.error.message}</p>
      ) : shown.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trophy />
            </EmptyMedia>
            <EmptyTitle>ยังไม่มีแมตช์</EmptyTitle>
            <EmptyDescription>กด “เพิ่มแมตช์” เพื่อเริ่มบันทึกคะแนน</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((match) => (
            <MatchRow key={match.id} match={match} />
          ))}
        </ul>
      )}
    </div>
  );
}
