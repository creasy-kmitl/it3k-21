import { Button } from "@it3k/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@it3k/ui/components/empty";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useHotkey } from "@tanstack/react-hotkeys";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LayoutGrid,
  Search,
  SearchX,
  Users,
} from "lucide-react";
import { type ReactNode, useCallback, useRef } from "react";

import { type FilterControl, useFilters, useSearchText } from "@/hooks/use-filters";
import type { ListFilters } from "@/lib/list-search";
import {
  ApiError,
  type LeadershipApi,
  type LeadershipDepartment,
  type LeadershipSummary,
  leadershipApi,
} from "@/lib/leadership";

import { DepartmentIcon, DepartmentLabel } from "./department-icon";
import LeadershipList from "./leadership-list";
import { PageHeader } from "./page-header";

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

const ALL_DEPARTMENTS = (
  <span className="flex items-center gap-2">
    <span
      aria-hidden
      className="inline-flex size-6 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5"
    >
      <LayoutGrid />
    </span>
    ทุกฝ่าย
  </span>
);

function errorMessage(error: Error) {
  if (error instanceof ApiError && error.status === 403) {
    return "คุณไม่มีสิทธิ์เข้าถึงรายชื่อนี้";
  }
  return `โหลดรายชื่อไม่สำเร็จ: ${error.message}`;
}

type Props = {
  api?: LeadershipApi;
  /** Controls shown next to each seat (contact, edit, delete). */
  renderActions?: (seat: LeadershipSummary, department?: LeadershipDepartment) => ReactNode;
  /** Shown in the toolbar when the server says the caller may add seats. */
  createAction?: ReactNode;
  /** Shown between the toolbar and the list, e.g. the create/edit form. */
  panel?: ReactNode;
  /** Search, department and page kept by the caller (in the URL); otherwise kept here. */
  filters?: FilterControl<ListFilters>;
};

export default function LeadershipDirectory({
  api = leadershipApi,
  renderActions,
  createAction,
  panel,
  filters: control,
}: Props) {
  // Changing a filter starts from page 1 again.
  const [filters, setFilters] = useFilters(control);
  const q = filters.q ?? "";
  const departmentId = filters.department;
  const page = filters.page ?? 1;
  const [search, setSearch] = useSearchText(q, (next) => setFilters({ q: next, page: undefined }));
  const setDepartmentId = (id: string | undefined) =>
    setFilters({ department: id, page: undefined });
  const goTo = (next: number) => setFilters({ page: next > 1 ? next : undefined });

  const searchRef = useRef<HTMLInputElement>(null);
  useHotkey("Mod+K", () => searchRef.current?.focus());

  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => api.departments(),
    staleTime: 5 * 60_000,
  });

  const departmentItems =
    departments.data?.map((d) => ({ value: d.id, label: <DepartmentLabel department={d} /> })) ??
    [];
  const departmentById = new Map(departments.data?.map((d) => [d.id, d]));

  // Only summaries are cached here; contact details are never part of a list.
  const roster = useQuery({
    queryKey: ["leadership", "list", { q, departmentId, page }],
    queryFn: () => api.list({ q: q || undefined, departmentId, page }),
    placeholderData: keepPreviousData,
  });
  // The previous page stays up while the next loads (so typing a search does
  // not flash); a page change still shows the skeleton so it reads as loading.
  const loading = roster.isPending || (roster.isPlaceholderData && roster.data.page !== page);

  const departmentList = departments.data;
  const actions = useCallback(
    (seat: LeadershipSummary) =>
      renderActions?.(
        seat,
        departmentList?.find((d) => d.id === seat.departmentId),
      ) ?? null,
    [renderActions, departmentList],
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        icon={FolderKanban}
        title="หัวหน้าฝ่าย"
        description="รายชื่อหัวหน้าและรองหัวหน้าของแต่ละฝ่าย"
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          items={[{ value: null, label: ALL_DEPARTMENTS }, ...departmentItems]}
          value={departmentId ?? null}
          onValueChange={(value: string | null) => setDepartmentId(value ?? undefined)}
        >
          <SelectTrigger aria-label="ฝ่าย" className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>{ALL_DEPARTMENTS}</SelectItem>
            {departmentItems.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        {roster.data?.canCreate && createAction}
      </div>

      {panel}

      {loading ? (
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
        <EmptyRoster
          query={q}
          department={departmentId ? departmentById.get(departmentId) : undefined}
          onClearSearch={() => setSearch("")}
          onAllDepartments={() => setDepartmentId(undefined)}
        />
      ) : (
        <div className="flex flex-col gap-6" aria-busy={roster.isFetching}>
          {groupByDepartment(roster.data.items).map((group) => (
            <section
              key={group.departmentId}
              aria-labelledby={`dept-${group.departmentId}`}
              className="flex flex-col gap-2"
            >
              <h2
                id={`dept-${group.departmentId}`}
                className="flex items-center gap-2 text-lg font-semibold"
              >
                <DepartmentIcon department={departmentById.get(group.departmentId)} />
                {group.departmentName}
              </h2>
              <LeadershipList
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

/** Says why the list is empty for the current filters, with a way out of each. */
function EmptyRoster({
  query,
  department,
  onClearSearch,
  onAllDepartments,
}: {
  query: string;
  department: LeadershipDepartment | undefined;
  onClearSearch: () => void;
  onAllDepartments: () => void;
}) {
  const quoted = `“${query}”`;
  const title = department
    ? query
      ? `ไม่พบ ${quoted} ในฝ่าย${department.name}`
      : `ฝ่าย${department.name}ยังไม่มีหัวหน้า`
    : query
      ? `ไม่พบ ${quoted}`
      : "ยังไม่มีรายชื่อหัวหน้าฝ่าย";
  const description = department
    ? query
      ? "ลองค้นหาด้วยคำอื่น หรือค้นหาในทุกฝ่าย"
      : "ฝ่ายนี้ยังไม่ได้ระบุหัวหน้าและรองหัวหน้า"
    : query
      ? "ลองค้นหาด้วยชื่อ ชื่อเล่น หรือชื่อฝ่ายอื่น"
      : "เมื่อมีการเพิ่มหัวหน้าและรองหัวหน้า รายชื่อจะแสดงที่นี่";

  return (
    <Empty className="flex-none border border-dashed">
      <EmptyHeader>
        {department ? (
          <EmptyMedia>
            <DepartmentIcon department={department} className="size-10 [&_svg]:size-5" />
          </EmptyMedia>
        ) : (
          <EmptyMedia variant="icon">{query ? <SearchX /> : <Users />}</EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {(query || department) && (
        <EmptyContent className="flex-row justify-center">
          {query && (
            <Button variant="outline" size="sm" onClick={onClearSearch}>
              ล้างคำค้นหา
            </Button>
          )}
          {department && (
            <Button variant="outline" size="sm" onClick={onAllDepartments}>
              <LayoutGrid /> ดูทุกฝ่าย
            </Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
