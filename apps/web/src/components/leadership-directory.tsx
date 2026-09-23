import { Button } from "@it3k/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@it3k/ui/components/empty";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useHotkey } from "@tanstack/react-hotkeys";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FolderKanban, Search } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  ApiError,
  type LeadershipApi,
  type LeadershipSummary,
  leadershipApi,
} from "@/lib/leadership";

import LeadershipTable from "./leadership-table";

type Group = { departmentId: string; departmentName: string; seats: LeadershipSummary[] };

/** The server sorts by department, so each department's seats are adjacent. */
function groupByDepartment(seats: LeadershipSummary[]): Group[] {
  const groups: Group[] = [];
  for (const seat of seats) {
    const last = groups.at(-1);
    if (last?.departmentId === seat.departmentId) {
      last.seats.push(seat);
    } else {
      groups.push({
        departmentId: seat.departmentId,
        departmentName: seat.departmentName,
        seats: [seat],
      });
    }
  }
  return groups;
}

function errorMessage(error: Error) {
  if (error instanceof ApiError && error.status === 403) {
    return "คุณไม่มีสิทธิ์เข้าถึงรายชื่อนี้";
  }
  return `โหลดรายชื่อไม่สำเร็จ: ${error.message}`;
}

type Props = {
  api?: LeadershipApi;
  /** Controls shown next to each seat (contact, edit, delete). */
  renderActions?: (seat: LeadershipSummary) => ReactNode;
  /** Shown in the toolbar when the server says the caller may add seats. */
  createAction?: ReactNode;
  /** Shown between the toolbar and the list, e.g. the create/edit form. */
  panel?: ReactNode;
};

export default function LeadershipDirectory({
  api = leadershipApi,
  renderActions,
  createAction,
  panel,
}: Props) {
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string>();
  const q = useDebouncedValue(search.trim(), 300);

  // The page belongs to one filter; changing the filter starts from page 1.
  const filterKey = JSON.stringify([q, departmentId]);
  const [paging, setPaging] = useState({ filterKey, page: 1 });
  const page = paging.filterKey === filterKey ? paging.page : 1;
  const goTo = (next: number) => setPaging({ filterKey, page: next });

  const searchRef = useRef<HTMLInputElement>(null);
  useHotkey("Mod+K", () => searchRef.current?.focus());

  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => api.departments(),
    staleTime: 5 * 60_000,
  });

  // Only summaries are cached here; contact details are never part of a list.
  const roster = useQuery({
    queryKey: ["leadership", "list", { q, departmentId, page }],
    queryFn: () => api.list({ q: q || undefined, departmentId, page }),
    placeholderData: keepPreviousData,
  });

  const actions = useCallback(
    (seat: LeadershipSummary) => renderActions?.(seat) ?? null,
    [renderActions],
  );

  return (
    <div className="container mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <FolderKanban className="size-7 text-primary" aria-hidden />
          หัวหน้าฝ่าย
        </h1>
        <p className="text-muted-foreground">รายชื่อหัวหน้าและรองหัวหน้าของแต่ละฝ่าย</p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label="ค้นหาชื่อ ชื่อเล่น หรือฝ่าย"
            placeholder="ค้นหาชื่อ ชื่อเล่น หรือฝ่าย"
            className="pl-9"
            maxLength={64}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 text-xs text-muted-foreground sm:block">
            ⌘K
          </kbd>
        </div>
        <select
          aria-label="ฝ่าย"
          className="h-9 rounded-4xl border border-input bg-input/30 px-3 text-sm"
          value={departmentId ?? ""}
          onChange={(e) => setDepartmentId(e.target.value || undefined)}
        >
          <option value="">ทุกฝ่าย</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {roster.data?.canCreate && createAction}
      </div>

      {panel}

      {roster.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : roster.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p>{errorMessage(roster.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void roster.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : roster.data.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>ไม่พบรายชื่อ</EmptyTitle>
            <EmptyDescription>ลองค้นหาด้วยคำอื่น หรือเลือกฝ่ายอื่น</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6" aria-busy={roster.isFetching}>
          {groupByDepartment(roster.data.items).map((group) => (
            <section
              key={group.departmentId}
              aria-labelledby={`dept-${group.departmentId}`}
              className="flex flex-col gap-2"
            >
              <h2 id={`dept-${group.departmentId}`} className="text-lg font-semibold">
                {group.departmentName}
              </h2>
              <LeadershipTable
                departmentName={group.departmentName}
                seats={group.seats}
                renderActions={actions}
              />
            </section>
          ))}
        </div>
      )}

      {roster.data && (page > 1 || roster.data.hasMore) && (
        <nav className="flex items-center justify-between" aria-label="เลื่อนหน้า">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goTo(page - 1)}
            aria-label="หน้าก่อนหน้า"
          >
            <ChevronLeft /> ก่อนหน้า
          </Button>
          <span className="text-sm text-muted-foreground">หน้า {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!roster.data.hasMore}
            onClick={() => goTo(page + 1)}
            aria-label="หน้าถัดไป"
          >
            ถัดไป <ChevronRight />
          </Button>
        </nav>
      )}
    </div>
  );
}
