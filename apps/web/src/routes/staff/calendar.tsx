import {
  CALENDAR_CATEGORIES,
  CALENDAR_MODES,
  CALENDAR_STATUSES,
  type CalendarCategory,
  type CalendarMode,
  GAMES,
} from "@it3k/db/calendar-rules";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, CloudAlert, Info, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AgendaView } from "@/components/calendar/agenda-view";
import {
  CalendarFilters,
  CalendarToolbar,
  type CalendarView,
  VIEWS,
} from "@/components/calendar/calendar-toolbar";
import { ItemSheet } from "@/components/calendar/item-sheet";
import { MonthView } from "@/components/calendar/month-view";
import { RunSheet } from "@/components/calendar/run-sheet";
import { TimeGridView } from "@/components/calendar/time-grid-view";
import { PageHeader } from "@/components/page-header";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useNow } from "@/hooks/use-now";
import { useApis } from "@/lib/api-context";
import {
  DAY_MS,
  HOUR_MS,
  addDays,
  addMonths,
  dateKey,
  formatBangkok,
  fromDateKey,
  monthGrid,
  startOfDay,
  startOfWeek,
} from "@/lib/bangkok-time";
import type { CalendarItem, CalendarQuery } from "@/lib/calendar";
import { LIVE_CATEGORIES } from "@/lib/calendar-labels";

const AGENDA_DAYS = 14;
/** How far ahead "next live" and "next release" look: the API's widest range. */
const JUMP_AHEAD_MS = 62 * DAY_MS;

const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const searchSchema = z.object({
  view: optional(z.enum(VIEWS)),
  date: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  // Comma-separated, so links stay short: `?modes=operations,delivery`.
  modes: optional(z.string().max(64)),
  category: optional(z.enum(CALENDAR_CATEGORIES)),
  status: optional(z.enum(CALENDAR_STATUSES)),
  game: optional(z.enum(GAMES)),
  departmentId: optional(z.string().max(64)),
  mine: optional(z.boolean()),
  archived: optional(z.boolean()),
  q: optional(z.string().max(64)),
  venue: optional(z.string().max(64)),
  streamPlatform: optional(z.string().max(64)),
  environment: optional(z.string().max(64)),
  item: optional(z.string().max(64)),
});

export type CalendarSearch = z.output<typeof searchSchema>;

export const Route = createFileRoute("/staff/calendar")({
  validateSearch: (search) => searchSchema.parse(search),
  component: RouteComponent,
});

const isMode = (value: string): value is CalendarMode =>
  (CALENDAR_MODES as readonly string[]).includes(value);

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { session } = Route.useRouteContext();
  return (
    <CalendarPage
      search={search}
      currentUserId={session.data?.user.id ?? ""}
      onSearch={(patch, options) =>
        void navigate({
          search: (previous) => ({ ...previous, ...patch }),
          replace: options?.replace ?? false,
        })
      }
    />
  );
}

function prefersAgenda() {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
}

/** The window each view shows, as epoch ms. */
export function viewRange(view: CalendarView, date: number) {
  switch (view) {
    case "month": {
      const weeks = monthGrid(date);
      const first = weeks[0]?.[0] ?? startOfDay(date);
      return { from: first, to: addDays(first, weeks.length * 7) };
    }
    case "week": {
      const from = startOfWeek(date);
      return { from, to: addDays(from, 7) };
    }
    case "day": {
      const from = startOfDay(date);
      return { from, to: addDays(from, 1) };
    }
    case "agenda": {
      const from = startOfDay(date);
      return { from, to: addDays(from, AGENDA_DAYS) };
    }
  }
}

function step(view: CalendarView, date: number, direction: 1 | -1) {
  if (view === "month") return addMonths(date, direction);
  if (view === "week") return addDays(date, 7 * direction);
  if (view === "agenda") return addDays(date, AGENDA_DAYS * direction);
  return addDays(date, direction);
}

function rangeLabel(view: CalendarView, from: number, to: number, date: number) {
  if (view === "month") return formatBangkok(date, "month");
  if (view === "day") return formatBangkok(from, "longDay");
  return `${formatBangkok(from, "day")} – ${formatBangkok(to - 1, "day")}`;
}

/** The calendar page, driven by its URL search params (and testable without a router). */
export function CalendarPage({
  search,
  onSearch,
  currentUserId,
}: {
  search: CalendarSearch;
  onSearch: (patch: Partial<CalendarSearch>, options?: { replace?: boolean }) => void;
  currentUserId: string;
}) {
  const { calendar, leadership } = useApis();
  const queryClient = useQueryClient();
  const now = useNow();
  const [agendaByDefault] = useState(prefersAgenda);
  const [createAt, setCreateAt] = useState<number | null>(null);
  const [searchText, setSearchText] = useState(search.q ?? "");
  const debouncedSearch = useDebouncedValue(searchText);

  // Only typing moves the URL; the URL never overwrites what is being typed.
  const lastSearch = useRef(debouncedSearch);
  useEffect(() => {
    if (lastSearch.current === debouncedSearch) return;
    lastSearch.current = debouncedSearch;
    onSearch({ q: debouncedSearch || undefined }, { replace: true });
  }, [debouncedSearch, onSearch]);

  const modes = search.modes?.split(",").filter(isMode);

  const view: CalendarView = search.view ?? (agendaByDefault ? "agenda" : "week");
  const date = (search.date && fromDateKey(search.date)) || now;
  const { from, to } = viewRange(view, date);

  const filters: Omit<CalendarQuery, "from" | "to"> = {
    modes,
    categories: search.category ? [search.category] : undefined,
    statuses: search.status ? [search.status] : undefined,
    game: search.game,
    departmentId: search.departmentId,
    ownerId: search.mine ? currentUserId : undefined,
    includeArchived: search.archived,
    q: search.q,
    venue: search.venue,
    streamPlatform: search.streamPlatform,
    environment: search.environment,
  };
  const query = { from, to, ...filters };
  const items = useQuery({
    queryKey: ["calendar", "items", query],
    queryFn: () => calendar.list(query),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => leadership.departments(),
    staleTime: 5 * 60_000,
  });

  const select = (item: CalendarItem | string) =>
    onSearch({ item: typeof item === "string" ? item : item.id });
  const openDay = (day: number) => onSearch({ view: "day", date: dateKey(day) });

  async function jump(target: "week" | "live" | "release") {
    if (target === "week") {
      onSearch({ view: "week", date: dateKey(now) });
      return;
    }
    const categories: CalendarCategory[] = target === "live" ? [...LIVE_CATEGORIES] : ["release"];
    const lookup = { from: now, to: now + JUMP_AHEAD_MS, categories };
    try {
      const page = await queryClient.fetchQuery({
        queryKey: ["calendar", "items", lookup],
        queryFn: () => calendar.list(lookup),
      });
      const next = page.items.find((item) => item.startAt >= now && item.status !== "cancelled");
      if (!next) {
        toast.info(target === "live" ? "ไม่พบ Live ถัดไปใน 62 วัน" : "ไม่พบ Release ถัดไปใน 62 วัน");
        return;
      }
      onSearch({ view: "day", date: dateKey(next.startAt), item: next.id });
    } catch (error) {
      toast.error(`ค้นหาไม่สำเร็จ: ${(error as Error).message}`);
    }
  }

  const list = items.data?.items ?? [];
  const canCreate = items.data?.canCreate ?? false;
  const canApprove = items.data?.canApprove ?? false;
  const showSkeleton = items.isPending || (items.isPlaceholderData && items.isFetching);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarDays}
        title="ปฏิทิน Tech/Live"
        description={
          <span className="tabular-nums">
            เวลาไทย (UTC+07:00) · ตอนนี้ {formatBangkok(now, "time")} น.
            {items.dataUpdatedAt > 0 &&
              ` · อัปเดตล่าสุด ${formatBangkok(items.dataUpdatedAt, "time")} น.`}
          </span>
        }
      />

      <RunSheet now={now} onSelect={select} />

      <div className="flex flex-col gap-3">
        <CalendarToolbar
          label={rangeLabel(view, from, to, date)}
          view={view}
          onView={(next) => onSearch({ view: next })}
          onPrevious={() => onSearch({ date: dateKey(step(view, date, -1)) })}
          onToday={() => onSearch({ date: dateKey(now) })}
          onNext={() => onSearch({ date: dateKey(step(view, date, 1)) })}
          onJump={(target) => void jump(target)}
          canCreate={canCreate}
          onCreate={() =>
            // The next whole hour on the day in view.
            setCreateAt(
              startOfDay(date) + (Math.floor((now - startOfDay(now)) / HOUR_MS) + 1) * HOUR_MS,
            )
          }
        />
        <CalendarFilters
          filters={{ ...search, modes }}
          onChange={(patch) => {
            const { modes: nextModes, ...rest } = patch;
            const modesPatch = "modes" in patch ? { modes: nextModes?.join(",") || undefined } : {};
            onSearch({ ...rest, ...modesPatch }, { replace: true });
          }}
          search={searchText}
          onSearch={setSearchText}
          departments={departments.data ?? []}
        />
      </div>

      {items.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <CloudAlert aria-hidden className="size-4 shrink-0" />
          {items.data
            ? `โหลดข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงข้อมูลเมื่อ ${formatBangkok(items.dataUpdatedAt, "time")} น.`
            : `โหลดปฏิทินไม่สำเร็จ: ${items.error.message}`}
          <Button variant="outline" size="sm" onClick={() => void items.refetch()}>
            <RefreshCw data-icon="inline-start" />
            ลองอีกครั้ง
          </Button>
        </div>
      )}
      {items.data?.truncated && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Info aria-hidden className="size-4" />
          แสดง 500 รายการแรก ใช้ตัวกรองเพื่อดูส่วนที่เหลือ
        </p>
      )}

      {showSkeleton && !items.data ? (
        <div role="status" aria-label="กำลังโหลด" className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div
          className={showSkeleton ? "opacity-60 transition-opacity" : undefined}
          aria-busy={showSkeleton}
        >
          {view === "month" && (
            <div className="overflow-x-auto">
              <div className="min-w-[48rem]">
                <MonthView
                  date={date}
                  now={now}
                  items={list}
                  onSelect={select}
                  onOpenDay={openDay}
                />
              </div>
            </div>
          )}
          {(view === "week" || view === "day") && (
            <div className="overflow-x-auto">
              <div className={view === "week" ? "min-w-[48rem]" : undefined}>
                <TimeGridView
                  start={from}
                  days={view === "week" ? 7 : 1}
                  now={now}
                  items={list}
                  onSelect={select}
                  onOpenDay={openDay}
                />
              </div>
            </div>
          )}
          {view === "agenda" && (
            <AgendaView start={from} days={AGENDA_DAYS} now={now} items={list} onSelect={select} />
          )}
        </div>
      )}

      <ItemSheet
        itemId={search.item ?? null}
        createAt={createAt}
        currentUserId={currentUserId}
        canApprove={canApprove}
        onSelect={(id) => {
          setCreateAt(null);
          select(id);
        }}
        onClose={() => {
          setCreateAt(null);
          onSearch({ item: undefined });
        }}
      />
    </div>
  );
}
