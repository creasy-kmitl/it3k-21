import { MATCH_STATUSES } from "@it3k/db/competition-rules";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, List, Network, SearchX } from "lucide-react";
import { useCallback } from "react";
import { z } from "zod";

import { BracketView, buildBrackets, fromPublicMatch } from "@/components/competition/bracket";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { MatchCard } from "@/components/public/match-card";
import { MatchFiltersBar } from "@/components/public/match-filters";
import { groupByDay } from "@/components/public/match-format";
import { PublicShell } from "@/components/public/public-shell";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { type MatchFilters, PUBLIC_COMPETITION_KEY } from "@/lib/public-competition";

const id = z.string().trim().min(1).max(100).optional().catch(undefined);

const searchSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  sportId: id,
  divisionId: id,
  venueId: id,
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  status: z.enum(MATCH_STATUSES).optional().catch(undefined),
  view: z.enum(["bracket"]).optional().catch(undefined),
});

export type MatchesViewMode = "list" | "bracket";

// Public, read signed out.
export const Route = createFileRoute("/matches")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({ meta: [{ title: "โปรแกรมและผลการแข่งขัน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { view, ...filters } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onChange = useCallback(
    (next: MatchFilters) => void navigate({ search: { ...next, view }, replace: true }),
    [navigate, view],
  );
  const onViewChange = useCallback(
    (next: MatchesViewMode) =>
      void navigate({
        search: (current) => ({ ...current, view: next === "bracket" ? next : undefined }),
        replace: true,
      }),
    [navigate],
  );
  return (
    <PublicShell>
      <MatchesView
        filters={filters}
        onChange={onChange}
        view={view ?? "list"}
        onViewChange={onViewChange}
      />
    </PublicShell>
  );
}

/**
 * Every match, filtered and searched, by day; or each division's knockout
 * bracket. Polls while any match is live.
 */
export function MatchesView({
  filters: chosen,
  onChange,
  view = "list",
  onViewChange,
}: {
  filters: MatchFilters;
  onChange: (next: MatchFilters) => void;
  view?: MatchesViewMode;
  onViewChange?: (next: MatchesViewMode) => void;
}) {
  const { publicCompetition: api } = useApis();
  // A bracket needs every match of its rounds, so only sport and division narrow it.
  const filters: MatchFilters =
    view === "bracket"
      ? {
          ...(chosen.sportId ? { sportId: chosen.sportId } : {}),
          ...(chosen.divisionId ? { divisionId: chosen.divisionId } : {}),
        }
      : chosen;
  const options = useQuery({
    queryKey: [...PUBLIC_COMPETITION_KEY, "filters"],
    queryFn: () => api.filters(),
    staleTime: 60_000,
  });
  const list = useQuery({
    queryKey: [...PUBLIC_COMPETITION_KEY, "matches", filters],
    queryFn: () => api.matches(filters),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((match) => match.status === "live") ? 10_000 : 60_000,
  });

  return (
    <>
      <PageHeader
        icon={CalendarDays}
        title="โปรแกรมและผลการแข่งขัน"
        description="ค้นหาแมตช์ ดูผลสด และผลที่จบแล้ว"
      />
      {onViewChange && (
        <SegmentedControl<MatchesViewMode>
          label="มุมมอง"
          className="w-fit"
          segments={[
            { value: "list", label: "รายการ", icon: List },
            { value: "bracket", label: "สายการแข่ง", icon: Network },
          ]}
          value={view}
          onChange={onViewChange}
        />
      )}
      <MatchFiltersBar
        options={options.data}
        value={view === "bracket" ? filters : chosen}
        onChange={onChange}
        bracket={view === "bracket"}
      />
      {list.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-6 w-40" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        </div>
      ) : list.isError ? (
        <ErrorState
          error={list.error}
          onRetry={() => list.refetch()}
          title="โหลดรายการแข่งขันไม่สำเร็จ"
        />
      ) : view === "bracket" ? (
        <PublicBrackets items={list.data.items} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={SearchX} title="ไม่พบแมตช์" description="ลองเปลี่ยนคำค้นหรือตัวกรอง" />
      ) : (
        <div className="flex flex-col gap-6" aria-busy={list.isFetching}>
          {groupByDay(list.data.items).map((day) => (
            <section
              key={day.key}
              aria-labelledby={`day-${day.key}`}
              className="flex flex-col gap-3"
            >
              <h2
                id={`day-${day.key}`}
                className="sticky top-14 z-10 -mx-4 bg-background/95 px-4 py-1 text-sm font-semibold text-muted-foreground backdrop-blur"
              >
                {day.label}
                <span className="ml-2 font-normal">{day.items.length} แมตช์</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {day.items.map((match) => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function PublicBrackets({ items }: { items: Parameters<typeof fromPublicMatch>[0][] }) {
  const brackets = buildBrackets(items.map(fromPublicMatch));
  if (brackets.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="ยังไม่มีสายการแข่ง"
        description="สายจะขึ้นเมื่อมีรอบน็อกเอาต์ ลองเลือกกีฬาหรือประเภทอื่น"
      />
    );
  }
  return <BracketView brackets={brackets} matchRoute="/matches/$matchId" />;
}
