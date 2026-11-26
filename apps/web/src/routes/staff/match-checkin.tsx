import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CalendarX, Flag, MonitorSmartphone, ScanLine } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  MatchCheckinCard,
  matchTitle,
  matchWhere,
  windowLabel,
} from "@/components/competition/checkin/match-checkin-card";
import { ConfirmForfeit, SideRoster } from "@/components/competition/checkin/match-roster";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { useApis } from "@/lib/api-context";
import type { RosterEntry, RosterSide } from "@/lib/competition-checkins";
import { toastError } from "@/lib/errors";
import { ApiError } from "@/lib/leadership";
import { optional } from "@/lib/list-search";

const searchSchema = z.object({
  venue: optional(z.string().max(64)),
  match: optional(z.string().max(64)),
});
export type MatchCheckinSearch = z.output<typeof searchSchema>;

export const Route = createFileRoute("/staff/match-checkin")({
  head: () => ({ meta: [{ title: "รายงานตัวแข่งขัน · IT3Kings" }] }),
  validateSearch: (search) => searchSchema.parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MatchCheckinPage
      search={search}
      onSearch={(patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }) })}
    />
  );
}

const LIST_KEY = ["competition-checkins", "list"] as const;
const matchKey = (matchId: string) => ["competition-checkins", "match", matchId] as const;

/**
 * Match check-in for staff: pick a venue or a match, see each side's players,
 * tick them in by hand (esports over Discord, or anyone the kiosk missed), and
 * forfeit a side that is still short once check-in has closed. Each venue's
 * kiosk opens from here.
 */
export function MatchCheckinPage({
  search,
  onSearch,
}: {
  search: MatchCheckinSearch;
  onSearch: (patch: Partial<MatchCheckinSearch>) => void;
}) {
  const { competitionCheckins: api } = useApis();
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => api.list(), refetchInterval: 30_000 });

  if (list.error instanceof ApiError && list.error.status === 403) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader icon={ScanLine} title="รายงานตัวแข่งขัน" />
        <EmptyState icon={ScanLine} title="บัญชีนี้ไม่มีสิทธิ์เช็คอินนักกีฬาเข้าแข่ง" />
      </div>
    );
  }

  const venues = list.data?.venues ?? [];
  const items = (list.data?.items ?? []).filter(
    (match) => !search.venue || match.venueId === search.venue,
  );
  const venue = venues.find((item) => item.id === search.venue);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ScanLine}
        title="รายงานตัวแข่งขัน"
        description="เช็คอินนักกีฬาก่อนแข่ง เปิด kiosk ประจำสนาม หรือเช็คอินเองสำหรับ Esports"
      />

      <div className="flex flex-col gap-3">
        <fieldset className="flex min-w-0 flex-wrap gap-2">
          <legend className="sr-only">สนาม</legend>
          <Button
            size="sm"
            variant={search.venue ? "outline" : "default"}
            aria-pressed={!search.venue}
            onClick={() => onSearch({ venue: undefined })}
          >
            ทุกสนาม
          </Button>
          {venues.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={search.venue === item.id ? "default" : "outline"}
              aria-pressed={search.venue === item.id}
              onClick={() => onSearch({ venue: item.id })}
            >
              {item.name}
            </Button>
          ))}
        </fieldset>
        {venue && (
          <Button
            variant="secondary"
            className="self-start"
            render={<Link to="/kiosk/matches/$venueId" params={{ venueId: venue.id }} />}
            nativeButton={false}
          >
            <MonitorSmartphone data-icon="inline-start" aria-hidden />
            เปิด kiosk ของ {venue.name}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section
          className={cn("flex flex-col gap-3", search.match && "max-lg:hidden")}
          aria-label="แมตช์"
        >
          {list.isPending ? (
            <>
              <Skeleton className="h-32 rounded-3xl" />
              <Skeleton className="h-32 rounded-3xl" />
            </>
          ) : list.isError && !list.data ? (
            <ErrorState
              error={list.error}
              onRetry={() => list.refetch()}
              title="โหลดแมตช์ไม่สำเร็จ"
              size="sm"
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={CalendarX}
              title="ไม่มีแมตช์ช่วงนี้"
              description="แสดงแมตช์ที่ยังไม่เริ่มตั้งแต่ 3 ชั่วโมงก่อนถึง 24 ชั่วโมงข้างหน้า"
            />
          ) : (
            items.map((match) => (
              <button
                key={match.id}
                type="button"
                className="rounded-3xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-current={search.match === match.id ? "true" : undefined}
                onClick={() => onSearch({ match: match.id })}
              >
                <MatchCheckinCard
                  match={match}
                  className={cn(
                    "transition-colors hover:bg-muted/50",
                    search.match === match.id && "border-primary",
                  )}
                />
              </button>
            ))
          )}
        </section>

        {search.match ? (
          <MatchPanel
            key={search.match}
            matchId={search.match}
            canForfeit={list.data?.canForfeit ?? false}
            onBack={() => onSearch({ match: undefined })}
          />
        ) : (
          <p className="hidden rounded-3xl border border-dashed p-8 text-center text-muted-foreground lg:block">
            เลือกแมตช์เพื่อดูรายชื่อและเช็คอินนักกีฬา
          </p>
        )}
      </div>
    </div>
  );
}

/** One match's rosters with ticks and the forfeit action. */
function MatchPanel({
  matchId,
  canForfeit: mayForfeit,
  onBack,
}: {
  matchId: string;
  canForfeit: boolean;
  onBack: () => void;
}) {
  const { competitionCheckins: api } = useApis();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: matchKey(matchId),
    queryFn: () => api.match(matchId),
    refetchInterval: 15_000,
  });
  const [confirming, setConfirming] = useState<RosterSide[] | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: matchKey(matchId) }),
      queryClient.invalidateQueries({ queryKey: LIST_KEY }),
    ]);

  const toggle = useMutation({
    mutationFn: ({
      side,
      entry,
      checked,
    }: {
      side: RosterSide;
      entry: RosterEntry;
      checked: boolean;
    }) =>
      checked
        ? api.checkIn(matchId, side.participantId, entry.userId)
        : api.undo(matchId, entry.userId),
    onError: (error) => toastError(error, "บันทึกการเช็คอินไม่สำเร็จ"),
    onSettled: refresh,
  });

  const forfeit = useMutation({
    mutationFn: ({ sides, version }: { sides: RosterSide[]; version: number }) =>
      api.forfeit(
        matchId,
        sides.map((side) => side.participantId),
        version,
      ),
    onSuccess: () => {
      toast.success("ปรับแพ้แล้ว");
      setConfirming(null);
    },
    onError: (error) => toastError(error, "ปรับแพ้ไม่สำเร็จ"),
    onSettled: refresh,
  });

  const back = (
    <Button variant="ghost" size="sm" className="self-start lg:hidden" onClick={onBack}>
      <ArrowLeft data-icon="inline-start" aria-hidden /> แมตช์ทั้งหมด
    </Button>
  );

  if (detail.isPending) {
    return (
      <section className="flex flex-col gap-3">
        {back}
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-48 rounded-2xl" />
      </section>
    );
  }
  if (detail.isError && !detail.data) {
    return (
      <section className="flex flex-col gap-3">
        {back}
        <ErrorState
          error={detail.error}
          onRetry={() => detail.refetch()}
          title="โหลดแมตช์ไม่สำเร็จ"
          size="sm"
        />
      </section>
    );
  }
  const { match, canCheckIn, canForfeit } = detail.data;
  const short = match.sides.filter((side) => side.checkedIn < match.minPlayers);

  return (
    <section className="flex flex-col gap-4" aria-label={matchTitle(match)}>
      {back}
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{matchTitle(match)}</h2>
        <p className="text-sm text-muted-foreground">
          {[matchWhere(match), windowLabel(match.window), `ขั้นต่ำ ${match.minPlayers} คนต่อฝั่ง`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {match.checkinMode === "manual" && (
          <p className="text-sm text-muted-foreground">
            ประเภทนี้รายงานตัวผ่าน Discord: ติ๊กชื่อนักกีฬาที่รายงานตัวแล้ว
          </p>
        )}
        {!canCheckIn && <p className="text-sm text-muted-foreground">แมตช์นี้เริ่มแข่ง จบ หรือยกเลิกแล้ว</p>}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {match.sides.map((side) => (
          <SideRoster
            key={side.participantId}
            side={side}
            min={match.minPlayers}
            canCheckIn={canCheckIn}
            busyUserId={toggle.isPending ? (toggle.variables?.entry.userId ?? null) : null}
            onToggle={(entry, checked) => toggle.mutate({ side, entry, checked })}
          />
        ))}
      </div>

      {mayForfeit && canForfeit && short.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-destructive/40 p-4">
          <p className="text-sm">
            ปิดรายงานตัวแล้ว {short.map((side) => side.label).join(" และ ")} ยังมีผู้เล่นไม่ครบ
          </p>
          <div className="flex flex-wrap gap-2">
            {short.map((side) => (
              <Button
                key={side.participantId}
                variant="destructive"
                onClick={() => setConfirming([side])}
              >
                <Flag data-icon="inline-start" aria-hidden /> ปรับแพ้ {side.label}
              </Button>
            ))}
            {short.length > 1 && (
              <Button variant="outline" onClick={() => setConfirming(short)}>
                ปรับแพ้ทุกฝั่งที่ไม่ครบ
              </Button>
            )}
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmForfeit
          sides={confirming}
          totalSides={match.sides.length}
          min={match.minPlayers}
          pending={forfeit.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => forfeit.mutate({ sides: confirming, version: match.version })}
        />
      )}
    </section>
  );
}
