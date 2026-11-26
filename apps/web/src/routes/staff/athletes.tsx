import { INSTITUTIONS, INSTITUTION_IDS, type Institution } from "@it3k/db/profile";
import {
  ATHLETE_SORTS,
  ATHLETE_SORT_LABELS,
  type AthleteSort,
  REGISTRATION_STATUSES,
  type RegistrationStatus,
  STATUS_LABELS,
  type SportIcon,
  reviewInput,
  studentIdInput,
} from "@it3k/db/sport-rules";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@it3k/ui/components/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FilterX,
  GraduationCap,
  History,
  IdCard,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  SearchX,
  Shirt,
  Trophy,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  IconLabel,
  type FieldIssues,
  RegistrationFieldsEditor,
  parseDraft,
  toDraft,
} from "@/components/registration-fields";
import { IconSelect, type IconSelectItem } from "@/components/icon-select";
import { InstitutionLabel, InstitutionLogo } from "@/components/institution-logo";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { SportArt } from "@/components/sport-art";
import { StatusBadge } from "@/components/sport-badges";
import { type FilterControl, useFilters, useSearchText } from "@/hooks/use-filters";
import { useApis } from "@/lib/api-context";
import type { AthleteFilters, AthleteItem } from "@/lib/athletes";
import { csvBlob } from "@/lib/csv";
import { optional, replacesHistory } from "@/lib/list-search";
import { downloadBlob } from "@/lib/qr-export";
import { ErrorState } from "@/components/error-state";
import { toastError } from "@/lib/errors";

const searchSchema = z.object({
  q: optional(z.string().max(64)),
  sport: optional(z.string().max(64)),
  status: optional(z.enum(REGISTRATION_STATUSES)),
  institution: optional(z.enum(INSTITUTION_IDS)),
  sort: optional(z.enum(ATHLETE_SORTS)),
  page: optional(z.number().int().min(2)),
});
export type AthleteSearch = z.output<typeof searchSchema>;

export const Route = createFileRoute("/staff/athletes")({
  validateSearch: (search) => searchSchema.parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AthletesPage
      filters={{
        value: search,
        onChange: (patch) =>
          void navigate({
            search: (previous) => ({ ...previous, ...patch }),
            replace: replacesHistory(patch),
          }),
      }}
    />
  );
}

export function institutionShort(id: Institution) {
  return INSTITUTIONS.find((institution) => institution.id === id)?.short ?? id;
}

const fullName = (athlete: AthleteItem["athlete"]) =>
  athlete.firstName ? `${athlete.prefix}${athlete.firstName} ${athlete.lastName}` : athlete.name;

/** Every registration the filters match, as a spreadsheet. */
export function athletesCsv(items: AthleteItem[]) {
  return csvBlob([
    [
      "registration_id",
      "user_id",
      "student_id",
      "prefix",
      "first_name",
      "last_name",
      "nickname",
      "phone",
      "institution",
      "sport",
      "division",
      "status",
      "shirt_number",
      "badminton_rank",
      "ign",
      "ign_reading",
      "facebook_url",
      "discord_username",
      "discord_user_id",
      "review_note",
      "registered_at",
    ],
    ...items.map((item) => [
      item.id,
      item.athlete.userId,
      item.athlete.studentId,
      item.athlete.prefix,
      item.athlete.firstName || item.athlete.name,
      item.athlete.lastName,
      item.athlete.nickname,
      item.athlete.phone,
      institutionShort(item.institution),
      item.sport.name,
      item.division.name,
      STATUS_LABELS[item.status],
      item.shirtNumber,
      item.badmintonRank,
      item.ign,
      item.ignReading,
      item.facebookUrl,
      item.discordUsername,
      item.discordUserId,
      item.reviewNote,
      new Date(item.createdAt).toISOString(),
    ]),
  ]);
}

type Acting = { kind: "reject"; items: AthleteItem[] } | { kind: "edit"; item: AthleteItem };

const SORT_ICONS: Record<AthleteSort, LucideIcon> = {
  division: ArrowDownWideNarrow,
  newest: Clock,
  oldest: History,
  name: ArrowDownAZ,
  institution: GraduationCap,
  shirt: Shirt,
};

/** Status colours: green approved, amber waiting, red rejected. */
export const STATUS_DOT: Record<RegistrationStatus, string> = {
  review: "bg-amber-500",
  approved: "bg-success",
  rejected: "bg-destructive",
};

type StatusTab = RegistrationStatus | "all";

const csvName = () => `it3k-athletes-${new Date().toISOString().slice(0, 10)}.csv`;
const who = (item: AthleteItem) => `${item.athlete.name} ${item.division.name}`;

/** A sport's illustration cropped to a square, as a small mark in a select. */
function SportMark({ icon, seed }: { icon: SportIcon; seed: string }) {
  return (
    <span aria-hidden className="size-5 shrink-0 overflow-hidden rounded-md">
      <SportArt icon={icon} seed={seed} label="" className="size-5" />
    </span>
  );
}

/**
 * Athlete registrations for registration staff. The flags from the API only
 * decide which buttons show; the API checks every action and its scope.
 */
export function AthletesPage({ filters: control }: { filters?: FilterControl<AthleteSearch> }) {
  const { athletes: api, sports: sportsApi } = useApis();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useFilters(control);
  const page = filters.page ?? 1;
  const [search, setSearch] = useSearchText(filters.q ?? "", (q) =>
    setFilters({ q, page: undefined }),
  );
  const [acting, setActing] = useState<Acting | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const query: AthleteFilters = {
    q: filters.q,
    sportId: filters.sport,
    status: filters.status,
    institution: filters.institution,
    sort: filters.sort,
  };
  // A selection belongs to the rows on screen: any new filter, sort or page clears it.
  const listKey = JSON.stringify({ ...query, page });
  const [selectionKey, setSelectionKey] = useState(listKey);
  if (selectionKey !== listKey) {
    setSelectionKey(listKey);
    setSelected(new Set());
  }

  const sports = useQuery({ queryKey: ["sports"], queryFn: () => sportsApi.list() });
  const list = useQuery({
    queryKey: ["athletes", "list", { ...query, page }],
    queryFn: () => api.list({ ...query, page }),
    placeholderData: keepPreviousData,
  });
  const loading = list.isPending || (list.isPlaceholderData && list.data.page !== page);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["athletes"] });

  /** Puts approved registrations back the way they were; offered on the success toast. */
  const undo = async (before: AthleteItem[], after: AthleteItem[]) => {
    try {
      for (const item of after) {
        const previous = before.find((entry) => entry.id === item.id);
        if (!previous) continue;
        await api.review(item.id, {
          status: previous.status,
          note: previous.reviewNote ?? "",
          version: item.version,
        });
      }
      toast.success("เลิกทำแล้ว");
    } catch (error) {
      toastError(error, "เลิกทำไม่สำเร็จ");
    } finally {
      void refresh();
    }
  };
  const approvedToast = (before: AthleteItem[], after: AthleteItem[]) =>
    toast.success(
      after.length === 1 ? `อนุมัติ ${after[0]?.athlete.name} แล้ว` : `อนุมัติ ${after.length} คนแล้ว`,
      { action: { label: "เลิกทำ", onClick: () => void undo(before, after) } },
    );

  const review = useMutation({
    mutationFn: ({ item, status }: { item: AthleteItem; status: RegistrationStatus }) =>
      api.review(item.id, { status, note: "", version: item.version }),
    onSuccess: (updated, { item, status }) =>
      status === "approved"
        ? approvedToast([item], [updated])
        : toast.success(`เปลี่ยนเป็น "${STATUS_LABELS[status]}" แล้ว`),
    onError: (error) => toastError(error, "เปลี่ยนสถานะไม่สำเร็จ"),
    onSettled: refresh,
  });
  // Every row's buttons wait on the one review, but only the clicked button spins.
  const reviewing = (item: AthleteItem, status: RegistrationStatus) =>
    review.isPending && review.variables.item.id === item.id && review.variables.status === status;

  // One request per registration, so each keeps the single review's checks
  // (team limits, conflicts) and its email; failures are counted, not fatal.
  const bulkApprove = useMutation({
    mutationFn: async (items: AthleteItem[]) => {
      const done: AthleteItem[] = [];
      let failed = 0;
      for (const item of items) {
        try {
          done.push(
            await api.review(item.id, { status: "approved", note: "", version: item.version }),
          );
        } catch {
          failed++;
        }
      }
      return { items, done, failed };
    },
    onSuccess: ({ items, done, failed }) => {
      if (done.length > 0) approvedToast(items, done);
      if (failed > 0) toast.error(`อนุมัติไม่สำเร็จ ${failed} คน (เต็มโควตาหรือมีคนแก้ไปแล้ว)`);
      setSelected(new Set());
    },
    onSettled: refresh,
  });

  const exporting = useMutation({
    mutationFn: async (source: "filtered" | "all" | AthleteItem[]) => {
      const items = Array.isArray(source)
        ? source
        : (await api.exportAll(source === "all" ? {} : query)).items;
      downloadBlob(athletesCsv(items), csvName());
      return items.length;
    },
    onSuccess: (count) => toast.success(`ส่งออก ${count} รายการ`),
    onError: (error) => toastError(error, "ส่งออกไม่สำเร็จ"),
  });

  const sportItems: IconSelectItem<string>[] = [
    { value: null, label: "ทุกกีฬา" },
    ...(sports.data?.items.map((sport) => ({
      value: sport.id,
      label: sport.name,
      icon: <SportMark icon={sport.icon} seed={sport.id} />,
    })) ?? []),
  ];
  const institutionItems: IconSelectItem<Institution>[] = [
    { value: null, label: "ทุกสถาบัน" },
    ...INSTITUTIONS.map((item) => ({
      value: item.id,
      label: item.short,
      icon: <InstitutionLogo institution={item} />,
    })),
  ];
  const sortItems: IconSelectItem<AthleteSort>[] = ATHLETE_SORTS.map((value) => {
    const Icon = SORT_ICONS[value];
    return { value, label: ATHLETE_SORT_LABELS[value], icon: <Icon aria-hidden /> };
  });

  const data = list.data;
  const scope = data?.scope;
  const counts = data?.counts;
  const allCount = counts ? counts.review + counts.approved + counts.rejected : null;
  const statusTabs = [
    { value: "all" as StatusTab, label: `ทั้งหมด${allCount === null ? "" : ` ${allCount}`}` },
    ...REGISTRATION_STATUSES.map((value) => ({
      value: value as StatusTab,
      label: `${STATUS_LABELS[value]}${counts ? ` ${counts[value]}` : ""}`,
    })),
  ];
  const filtered = !!(filters.q || filters.sport || filters.status || filters.institution);
  const clearFilters = () => {
    setSearch("");
    setFilters({
      q: undefined,
      sport: undefined,
      status: undefined,
      institution: undefined,
      page: undefined,
    });
  };

  const items = data?.items ?? [];
  const selectable = !!(data?.canReview || data?.canExport);
  const chosen = items.filter((item) => selected.has(item.id));
  const allChosen = items.length > 0 && chosen.length === items.length;
  const toggle = (id: string, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          icon={Trophy}
          title="นักกีฬา"
          description={
            scope?.kind === "institution"
              ? `การสมัครของ ${institutionShort(scope.institution)}`
              : "การสมัครของทุกสถาบัน"
          }
        />
        {data?.canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={exporting.isPending}
              render={
                <LoadingButton variant="outline" icon={Download} loading={exporting.isPending} />
              }
            >
              ส่งออก CSV
              <ChevronDown data-icon="inline-end" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>ส่งออกเป็น CSV</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exporting.mutate("filtered")}>
                  <Search aria-hidden />
                  ตามตัวกรองตอนนี้ ({data.total} รายการ)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exporting.mutate("all")}>
                  <Download aria-hidden />
                  ทั้งหมด
                </DropdownMenuItem>
                {chosen.length > 0 && (
                  <DropdownMenuItem onClick={() => exporting.mutate(chosen)}>
                    <Check aria-hidden />
                    เฉพาะที่เลือก ({chosen.length} รายการ)
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <SegmentedControl
          label="สถานะ"
          segments={statusTabs}
          value={filters.status ?? "all"}
          onChange={(value) =>
            setFilters({ status: value === "all" ? undefined : value, page: undefined })
          }
          className="w-max"
        />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <IconSelect
          label="กีฬา"
          items={sportItems}
          value={filters.sport ?? null}
          icon={<Trophy aria-hidden className="text-muted-foreground" />}
          onChange={(sport) => setFilters({ sport: sport ?? undefined, page: undefined })}
          className="lg:w-48"
        />
        {scope?.kind === "all" && (
          <IconSelect
            label="สถาบัน"
            items={institutionItems}
            value={filters.institution ?? null}
            icon={<GraduationCap aria-hidden className="text-muted-foreground" />}
            onChange={(institution) =>
              setFilters({ institution: institution ?? undefined, page: undefined })
            }
            className="lg:w-48"
          />
        )}
        <IconSelect
          label="เรียงตาม"
          items={sortItems}
          value={filters.sort ?? "division"}
          icon={<ArrowUpDown aria-hidden />}
          onChange={(sort) =>
            setFilters({
              sort: sort === "division" ? undefined : (sort ?? undefined),
              page: undefined,
            })
          }
          className="lg:w-48"
        />
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="ค้นหาชื่อหรือรหัสนักศึกษา"
            placeholder="ค้นหาชื่อหรือรหัสนักศึกษา"
            className="pl-9"
            maxLength={64}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {filtered && (
          <Button variant="ghost" onClick={clearFilters}>
            <FilterX data-icon="inline-start" aria-hidden />
            ล้างตัวกรอง
          </Button>
        )}
      </div>

      {loading ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} title="โหลดรายชื่อไม่สำเร็จ" />
      ) : items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden />
            </EmptyMedia>
            <EmptyTitle>ไม่พบการสมัคร</EmptyTitle>
            <EmptyDescription>
              {filtered ? "ไม่มีการสมัครที่ตรงกับตัวกรองนี้" : "ยังไม่มีใครสมัครเป็นนักกีฬา"}
            </EmptyDescription>
          </EmptyHeader>
          {filtered && (
            <EmptyContent>
              <Button variant="outline" onClick={clearFilters}>
                <FilterX data-icon="inline-start" aria-hidden />
                ล้างตัวกรอง
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col rounded-2xl border">
          {selectable && (
            <label className="flex items-center gap-3 border-b px-4 py-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allChosen}
                indeterminate={chosen.length > 0 && !allChosen}
                onCheckedChange={(on) =>
                  setSelected(new Set(on ? items.map((item) => item.id) : []))
                }
              />
              {chosen.length > 0 ? `เลือกแล้ว ${chosen.length} คน` : "เลือกทั้งหน้า"}
            </label>
          )}
          <ul className="flex flex-col divide-y" aria-busy={list.isFetching}>
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {selectable && (
                  <Checkbox
                    aria-label={`เลือก ${who(item)}`}
                    checked={selected.has(item.id)}
                    onCheckedChange={(on) => toggle(item.id, on)}
                  />
                )}
                <Avatar>
                  <AvatarImage src={item.athlete.image ?? undefined} alt="" />
                  <AvatarFallback>
                    {item.athlete.name.trim().slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium">
                    {fullName(item.athlete)}
                    {item.athlete.nickname && (
                      <span className="text-muted-foreground"> ({item.athlete.nickname})</span>
                    )}
                  </span>
                  <span className="text-sm">
                    {item.sport.name} · {item.division.name}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={item.status} />
                    <InstitutionLabel
                      institution={item.institution}
                      className="rounded-md border px-1.5 py-0.5 text-foreground"
                    />
                    {item.athlete.studentId && <span>รหัส {item.athlete.studentId}</span>}
                    {item.shirtNumber !== null && <span>เบอร์ {item.shirtNumber}</span>}
                    {item.badmintonRank !== null && <span>มือ {item.badmintonRank}</span>}
                    {item.ign && <span>IGN {item.ign}</span>}
                    {item.discordUsername && <span>Discord {item.discordUsername}</span>}
                  </span>
                  {item.reviewNote && (
                    <span className="text-sm text-destructive">เหตุผล: {item.reviewNote}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {data?.canReview && item.status !== "approved" && (
                    <LoadingButton
                      variant="success"
                      size="sm"
                      aria-label={`อนุมัติ ${who(item)}`}
                      icon={Check}
                      loading={reviewing(item, "approved")}
                      disabled={review.isPending || bulkApprove.isPending}
                      onClick={() => review.mutate({ item, status: "approved" })}
                    >
                      อนุมัติ
                    </LoadingButton>
                  )}
                  {data?.canReview && item.status !== "rejected" && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`ไม่อนุมัติ ${who(item)}`}
                      onClick={() => setActing({ kind: "reject", items: [item] })}
                    >
                      <X data-icon="inline-start" aria-hidden className="text-destructive" />
                      ไม่อนุมัติ
                    </Button>
                  )}
                  {((data?.canReview && item.status !== "review") || data?.canEdit) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <LoadingButton
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`ตัวเลือกเพิ่มเติม ${who(item)}`}
                            icon={MoreHorizontal}
                            loading={reviewing(item, "review")}
                          />
                        }
                      />
                      <DropdownMenuContent align="end" className="w-52">
                        {data?.canEdit && (
                          <DropdownMenuItem onClick={() => setActing({ kind: "edit", item })}>
                            <Pencil aria-hidden />
                            แก้ไขข้อมูล
                          </DropdownMenuItem>
                        )}
                        {data?.canReview && item.status !== "review" && (
                          <>
                            {data.canEdit && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              disabled={review.isPending}
                              onClick={() => review.mutate({ item, status: "review" })}
                            >
                              <RotateCcw aria-hidden />
                              กลับไปรอตรวจสอบ
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (page > 1 || data.hasMore) && (
        <nav className="flex items-center justify-between" aria-label="เลื่อนหน้า">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setFilters({ page: page > 2 ? page - 1 : undefined })}
          >
            <ChevronLeft /> ก่อนหน้า
          </Button>
          <span className="text-sm text-muted-foreground">
            หน้า {page} / {data.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!data.hasMore}
            onClick={() => setFilters({ page: page + 1 })}
          >
            ถัดไป <ChevronRight />
          </Button>
        </nav>
      )}

      {chosen.length > 0 && (
        <div
          role="region"
          aria-label="จัดการที่เลือก"
          className="sticky bottom-4 z-10 mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur"
        >
          <span className="mr-auto text-sm font-medium">เลือก {chosen.length} คน</span>
          {data?.canReview && (
            <>
              <LoadingButton
                variant="success"
                size="sm"
                icon={Check}
                loading={bulkApprove.isPending}
                disabled={chosen.every((item) => item.status === "approved")}
                onClick={() =>
                  bulkApprove.mutate(chosen.filter((item) => item.status !== "approved"))
                }
              >
                อนุมัติที่เลือก
              </LoadingButton>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  bulkApprove.isPending || chosen.every((item) => item.status === "rejected")
                }
                onClick={() =>
                  setActing({
                    kind: "reject",
                    items: chosen.filter((item) => item.status !== "rejected"),
                  })
                }
              >
                <X data-icon="inline-start" aria-hidden className="text-destructive" />
                ไม่อนุมัติที่เลือก
              </Button>
            </>
          )}
          {data?.canExport && (
            <Button variant="outline" size="sm" onClick={() => exporting.mutate(chosen)}>
              <Download data-icon="inline-start" aria-hidden />
              ส่งออก
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="ยกเลิกการเลือก"
            onClick={() => setSelected(new Set())}
          >
            <X />
          </Button>
        </div>
      )}

      {acting?.kind === "reject" && (
        <RejectDialog
          key={acting.items.map((item) => item.id).join()}
          items={acting.items}
          onClose={() => setActing(null)}
          onDone={() => setSelected(new Set())}
        />
      )}
      {acting?.kind === "edit" && (
        <EditDialog key={acting.item.id} item={acting.item} onClose={() => setActing(null)} />
      )}
    </div>
  );
}

function RejectDialog({
  items,
  onClose,
  onDone,
}: {
  items: AthleteItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [item] = items;
  const { athletes: api } = useApis();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: async () => {
      const parsed = reviewInput.safeParse({ status: "rejected", note });
      if (!parsed.success) {
        setIssue(parsed.error.issues[0]?.message ?? "กรอกเหตุผล");
        return false;
      }
      let failed = 0;
      for (const entry of items) {
        try {
          await api.review(entry.id, { ...parsed.data, version: entry.version });
        } catch (error) {
          // One registration fails like before; in a batch the rest still go through.
          if (items.length === 1) throw error;
          failed++;
        }
      }
      if (failed > 0) toast.error(`ไม่อนุมัติไม่สำเร็จ ${failed} คน`);
      return true;
    },
    onSuccess: (done) => {
      if (!done) return;
      toast.success(items.length === 1 ? "ไม่อนุมัติแล้ว" : `ไม่อนุมัติ ${items.length} คนแล้ว`);
      onDone();
      onClose();
    },
    onError: (error) => toastError(error, "ไม่อนุมัติไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["athletes"] }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            reject.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {items.length === 1 ? `ไม่อนุมัติ ${item?.athlete.name}` : `ไม่อนุมัติ ${items.length} คน`}
            </DialogTitle>
            <DialogDescription>
              {items.length === 1 && item
                ? `${item.sport.name} · ${item.division.name} นักกีฬาจะเห็นเหตุผลนี้`
                : "ใช้เหตุผลเดียวกันทุกคน นักกีฬาจะเห็นเหตุผลนี้"}
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!issue}>
            <FieldLabel htmlFor="reject-note">เหตุผล</FieldLabel>
            <Textarea
              id="reject-note"
              value={note}
              maxLength={500}
              aria-invalid={!!issue}
              onChange={(event) => setNote(event.target.value)}
            />
            {issue && <FieldDescription>{issue}</FieldDescription>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton type="submit" variant="destructive" loading={reject.isPending}>
              ไม่อนุมัติ
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ item, onClose }: { item: AthleteItem; onClose: () => void }) {
  const { athletes: api } = useApis();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(item));
  const [studentId, setStudentId] = useState(item.athlete.studentId ?? "");
  const [institution, setInstitution] = useState<Institution>(item.institution);
  const [issues, setIssues] = useState<FieldIssues & { studentId?: string }>({});
  const institutionItems = INSTITUTIONS.map((entry) => ({
    value: entry.id,
    label: entry.short,
    icon: <InstitutionLogo institution={entry} />,
  }));

  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseDraft(item.division, draft);
      const id = studentIdInput.safeParse(studentId);
      if (!parsed.ok || !id.success) {
        setIssues({
          ...(parsed.ok ? {} : parsed.issues),
          ...(id.success ? {} : { studentId: id.error.issues[0]?.message }),
        });
        return false;
      }
      setIssues({});
      await api.edit(item.id, {
        ...parsed.fields,
        studentId: id.data,
        institution,
        version: item.version,
      });
      return true;
    },
    onSuccess: (saved) => {
      if (!saved) return;
      toast.success("บันทึกแล้ว");
      onClose();
    },
    onError: (error) => toastError(error, "บันทึกไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["athletes"] }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>แก้ไข {item.athlete.name}</DialogTitle>
            <DialogDescription>
              {item.sport.name} · {item.division.name}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!issues.studentId}>
              <IconLabel htmlFor="athlete-student-id" icon={IdCard}>
                รหัสนักศึกษา
              </IconLabel>
              <Input
                id="athlete-student-id"
                value={studentId}
                aria-invalid={!!issues.studentId}
                onChange={(event) => setStudentId(event.target.value)}
              />
              {issues.studentId && <FieldDescription>{issues.studentId}</FieldDescription>}
            </Field>
            <Field>
              <IconLabel htmlFor="athlete-institution" icon={GraduationCap}>
                สถาบัน
              </IconLabel>
              <IconSelect
                id="athlete-institution"
                label="สถาบันของนักกีฬา"
                items={institutionItems}
                value={institution}
                onChange={(value) => value && setInstitution(value)}
              />
              {institution !== item.institution && (
                <FieldDescription>ย้ายทุกการสมัครของบัญชีนี้ไปสถาบันใหม่</FieldDescription>
              )}
            </Field>
            <RegistrationFieldsEditor
              division={item.division}
              draft={draft}
              issues={issues}
              onChange={setDraft}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton type="submit" loading={save.isPending}>
              บันทึก
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
