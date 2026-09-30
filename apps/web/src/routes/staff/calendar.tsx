import { CALENDAR_STATUSES } from "@it3k/db/calendar-rules";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  type DepartmentScope,
  DepartmentScopePicker,
  VIEWS,
} from "@/components/calendar/calendar-toolbar";
import {
  type CalendarShortcuts,
  CalendarShortcutsProvider,
  type ItemIntent,
} from "@/components/calendar/calendar-shortcuts";
import { ItemSheet } from "@/components/calendar/item-sheet";
import { MonthView } from "@/components/calendar/month-view";
import { TimeGridView } from "@/components/calendar/time-grid-view";
import { PageHeader } from "@/components/page-header";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useNow } from "@/hooks/use-now";
import { useApis } from "@/lib/api-context";
import {
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
import { ApiError } from "@/lib/leadership";

const AGENDA_DAYS = 14;
/** Remembers the last department scope, so the calendar reopens on it. */
const SCOPE_KEY = "it3k:calendar-departments";

const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const searchSchema = z.object({
  view: optional(z.enum(VIEWS)),
  date: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  // `mine`, `all` or comma-separated department ids, so links stay short.
  depts: optional(z.string().max(1000)),
  status: optional(z.enum(CALENDAR_STATUSES)),
  mine: optional(z.boolean()),
  q: optional(z.string().max(64)),
  item: optional(z.string().max(64)),
});

export type CalendarSearch = z.output<typeof searchSchema>;

export const Route = createFileRoute("/staff/calendar")({
  validateSearch: (search) => searchSchema.parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { session } = Route.useRouteContext();
  return (
    <CalendarPage
      search={search}
      currentUserId={session.data?.user.id ?? ""}
      myDepartmentId={session.data?.user.departmentId ?? null}
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

function readStoredScope(): string | undefined {
  try {
    return window.localStorage.getItem(SCOPE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeScope(value: string) {
  try {
    window.localStorage.setItem(SCOPE_KEY, value);
  } catch {
    // Private windows and blocked storage just forget the choice.
  }
}

/** `depts` from the URL as a scope; the viewer's own department unless it says otherwise. */
export function parseScope(
  depts: string | undefined,
  myDepartmentId: string | null,
): DepartmentScope {
  if (depts === "all") return { kind: "all" };
  if (depts && depts !== "mine") {
    const ids = [...new Set(depts.split(",").filter(Boolean))];
    if (ids.length > 0) return { kind: "some", ids };
  }
  return myDepartmentId ? { kind: "mine" } : { kind: "all" };
}

export function serializeScope(scope: DepartmentScope): string {
  return scope.kind === "some" ? scope.ids.join(",") : scope.kind;
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
  myDepartmentId,
}: {
  search: CalendarSearch;
  onSearch: (patch: Partial<CalendarSearch>, options?: { replace?: boolean }) => void;
  currentUserId: string;
  /** The viewer's department from their session; the calendar opens on it. */
  myDepartmentId: string | null;
}) {
  const { calendar, leadership } = useApis();
  const now = useNow();
  const [agendaByDefault] = useState(prefersAgenda);
  const [storedScope] = useState(readStoredScope);
  const [createAt, setCreateAt] = useState<number | null>(null);
  // What a shortcut asked the item panel to open straight into.
  const [intent, setIntent] = useState<ItemIntent | null>(null);
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState(search.q ?? "");
  const debouncedSearch = useDebouncedValue(searchText);

  // Only typing moves the URL; the URL never overwrites what is being typed.
  const lastSearch = useRef(debouncedSearch);
  useEffect(() => {
    if (lastSearch.current === debouncedSearch) return;
    lastSearch.current = debouncedSearch;
    onSearch({ q: debouncedSearch || undefined }, { replace: true });
  }, [debouncedSearch, onSearch]);

  const scope = parseScope(search.depts ?? storedScope, myDepartmentId);
  const setScope = (next: DepartmentScope) => {
    const value = serializeScope(next);
    storeScope(value);
    onSearch({ depts: value }, { replace: true });
  };

  const view: CalendarView = search.view ?? (agendaByDefault ? "agenda" : "week");
  const date = (search.date && fromDateKey(search.date)) || now;
  const { from, to } = viewRange(view, date);

  const departmentIds =
    scope.kind === "mine" && myDepartmentId
      ? [myDepartmentId]
      : scope.kind === "some"
        ? scope.ids
        : undefined;
  const query: CalendarQuery = {
    from,
    to,
    departmentIds,
    statuses: search.status ? [search.status] : undefined,
    ownerId: search.mine ? currentUserId : undefined,
    q: search.q,
  };
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

  const select = (item: CalendarItem | string) => {
    setIntent(null);
    onSearch({ item: typeof item === "string" ? item : item.id });
  };
  const openDay = (day: number) => onSearch({ view: "day", date: dateKey(day) });

  const list = items.data?.items ?? [];
  const canCreate = items.data?.canCreate ?? false;
  const viewer = {
    departmentId: items.data?.myDepartmentId ?? myDepartmentId,
    isAdmin: items.data?.isAdmin ?? false,
  };
  const confirm = useMutation({
    mutationFn: (item: CalendarItem) =>
      calendar.update(item.id, { status: "confirmed", version: item.version }),
    onSuccess: () => toast.success("ยืนยันรายการแล้ว"),
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 409
          ? "มีคนแก้ไขรายการนี้ก่อนคุณ ข้อมูลล่าสุดโหลดให้แล้ว"
          : `บันทึกไม่สำเร็จ: ${error.message}`,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["calendar"] }),
  });
  const shortcuts: CalendarShortcuts = {
    open: (item, next) => {
      setCreateAt(null);
      setIntent(next ?? null);
      onSearch({ item: item.id });
    },
    confirm: (item) => confirm.mutate(item),
    openDay,
    createAt: canCreate ? (start) => setCreateAt(start) : null,
  };

  const showSkeleton = items.isPending || (items.isPlaceholderData && items.isFetching);
  const departmentName = (id: string | null | undefined) =>
    departments.data?.find((d) => d.id === id)?.name;

  const title =
    scope.kind === "all"
      ? "ปฏิทินทุกแผนก"
      : scope.kind === "mine"
        ? `ปฏิทิน${departmentName(myDepartmentId) ? ` · ${departmentName(myDepartmentId)}` : "แผนกของฉัน"}`
        : scope.ids.length === 1
          ? `ปฏิทิน · ${departmentName(scope.ids[0]) ?? "1 แผนก"}`
          : `ปฏิทิน · ${scope.ids.length} แผนก`;
  // New items go to the one department on screen, else the viewer's own.
  const createDepartmentId =
    scope.kind === "some" &&
    scope.ids.length === 1 &&
    (viewer.isAdmin || scope.ids[0] === viewer.departmentId)
      ? (scope.ids[0] ?? null)
      : viewer.departmentId;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarDays}
        title={title}
        description={
          <span className="tabular-nums">
            เวลาไทย (UTC+07:00) · ตอนนี้ {formatBangkok(now, "time")} น.
            {items.dataUpdatedAt > 0 &&
              ` · อัปเดตล่าสุด ${formatBangkok(items.dataUpdatedAt, "time")} น.`}
          </span>
        }
      />

      <div className="flex flex-col gap-3">
        <DepartmentScopePicker
          scope={scope}
          onChange={setScope}
          departments={departments.data ?? []}
          myDepartmentId={myDepartmentId}
        />
        <CalendarToolbar
          label={rangeLabel(view, from, to, date)}
          view={view}
          onView={(next) => onSearch({ view: next })}
          onPrevious={() => onSearch({ date: dateKey(step(view, date, -1)) })}
          onToday={() => onSearch({ date: dateKey(now) })}
          onNext={() => onSearch({ date: dateKey(step(view, date, 1)) })}
          canCreate={canCreate}
          onCreate={() =>
            // The next whole hour on the day in view.
            setCreateAt(
              startOfDay(date) + (Math.floor((now - startOfDay(now)) / HOUR_MS) + 1) * HOUR_MS,
            )
          }
        />
        <CalendarFilters
          filters={search}
          onChange={(patch) => onSearch(patch, { replace: true })}
          search={searchText}
          onSearch={setSearchText}
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
        <CalendarShortcutsProvider value={shortcuts}>
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
              <AgendaView
                start={from}
                days={AGENDA_DAYS}
                now={now}
                items={list}
                onSelect={select}
              />
            )}
          </div>
        </CalendarShortcutsProvider>
      )}

      <ItemSheet
        itemId={search.item ?? null}
        create={createAt === null ? null : { start: createAt, departmentId: createDepartmentId }}
        viewer={viewer}
        intent={intent}
        onSelect={(id) => {
          setCreateAt(null);
          select(id);
        }}
        onClose={() => {
          setCreateAt(null);
          setIntent(null);
          onSearch({ item: undefined });
        }}
      />
    </div>
  );
}
