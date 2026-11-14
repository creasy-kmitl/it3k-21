import { INSTITUTIONS, INSTITUTION_IDS, type Institution } from "@it3k/db/profile";
import {
  REGISTRATION_STATUSES,
  type RegistrationStatus,
  STATUS_LABELS,
  reviewInput,
  studentIdInput,
} from "@it3k/db/sport-rules";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  RotateCcw,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  type FieldIssues,
  RegistrationFieldsEditor,
  parseDraft,
  toDraft,
} from "@/components/registration-fields";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/sport-badges";
import { type FilterControl, useFilters, useSearchText } from "@/hooks/use-filters";
import { useApis } from "@/lib/api-context";
import type { AthleteFilters, AthleteItem } from "@/lib/athletes";
import { csvBlob } from "@/lib/csv";
import { optional, replacesHistory } from "@/lib/list-search";
import { downloadBlob } from "@/lib/qr-export";

const searchSchema = z.object({
  q: optional(z.string().max(64)),
  sport: optional(z.string().max(64)),
  status: optional(z.enum(REGISTRATION_STATUSES)),
  institution: optional(z.enum(INSTITUTION_IDS)),
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

type Acting = { kind: "reject"; item: AthleteItem } | { kind: "edit"; item: AthleteItem };

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
  const query: AthleteFilters = {
    q: filters.q,
    sportId: filters.sport,
    status: filters.status,
    institution: filters.institution,
  };

  const sports = useQuery({ queryKey: ["sports"], queryFn: () => sportsApi.list() });
  const list = useQuery({
    queryKey: ["athletes", "list", { ...query, page }],
    queryFn: () => api.list({ ...query, page }),
    placeholderData: keepPreviousData,
  });
  const loading = list.isPending || (list.isPlaceholderData && list.data.page !== page);

  const review = useMutation({
    mutationFn: ({ item, status }: { item: AthleteItem; status: RegistrationStatus }) =>
      api.review(item.id, { status, note: "", version: item.version }),
    onSuccess: (_, { status }) => toast.success(`เปลี่ยนเป็น "${STATUS_LABELS[status]}" แล้ว`),
    onError: (error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["athletes"] }),
  });
  const exporting = useMutation({
    mutationFn: async () => {
      const { items } = await api.exportAll(query);
      downloadBlob(
        athletesCsv(items),
        `it3k-athletes-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      return items.length;
    },
    onSuccess: (count) => toast.success(`ส่งออก ${count} รายการ`),
    onError: (error) => toast.error(error.message),
  });

  const sportItems = [
    { value: null, label: "ทุกกีฬา" },
    ...(sports.data?.items.map((sport) => ({ value: sport.id, label: sport.name })) ?? []),
  ];
  const statusItems = [
    { value: null, label: "ทุกสถานะ" },
    ...REGISTRATION_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
  ];
  const institutionItems = [
    { value: null, label: "ทุกสถาบัน" },
    ...INSTITUTIONS.map((item) => ({ value: item.id, label: item.short })),
  ];
  const scope = list.data?.scope;

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
        {list.data?.canExport && (
          <Button
            variant="outline"
            disabled={exporting.isPending}
            onClick={() => exporting.mutate()}
          >
            <Download data-icon="inline-start" aria-hidden />
            ส่งออก CSV
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <FilterSelect
          label="กีฬา"
          items={sportItems}
          value={filters.sport ?? null}
          onChange={(sport) => setFilters({ sport, page: undefined })}
        />
        <FilterSelect
          label="สถานะ"
          items={statusItems}
          value={filters.status ?? null}
          onChange={(status) => setFilters({ status, page: undefined })}
        />
        {scope?.kind === "all" && (
          <FilterSelect
            label="สถาบัน"
            items={institutionItems}
            value={filters.institution ?? null}
            onChange={(institution) => setFilters({ institution, page: undefined })}
          />
        )}
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
      </div>

      {loading ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : list.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p>โหลดรายชื่อไม่สำเร็จ: {list.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : list.data.items.length === 0 ? (
        <p className="text-muted-foreground">ไม่พบการสมัคร</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border" aria-busy={list.isFetching}>
          {list.data.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
                  <span className="rounded-md border px-1.5 py-0.5">
                    {institutionShort(item.institution)}
                  </span>
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
              <div className="flex shrink-0 items-center">
                {list.data.canReview && item.status !== "approved" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`อนุมัติ ${item.athlete.name} ${item.division.name}`}
                    disabled={review.isPending}
                    onClick={() => review.mutate({ item, status: "approved" })}
                  >
                    <Check className="text-primary" />
                  </Button>
                )}
                {list.data.canReview && item.status !== "rejected" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`ไม่อนุมัติ ${item.athlete.name} ${item.division.name}`}
                    onClick={() => setActing({ kind: "reject", item })}
                  >
                    <X className="text-destructive" />
                  </Button>
                )}
                {list.data.canReview && item.status !== "review" && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`กลับไปรอตรวจสอบ ${item.athlete.name} ${item.division.name}`}
                    disabled={review.isPending}
                    onClick={() => review.mutate({ item, status: "review" })}
                  >
                    <RotateCcw />
                  </Button>
                )}
                {list.data.canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`แก้ไข ${item.athlete.name} ${item.division.name}`}
                    onClick={() => setActing({ kind: "edit", item })}
                  >
                    <Pencil />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.data && (page > 1 || list.data.hasMore) && (
        <nav className="flex items-center justify-between" aria-label="เลื่อนหน้า">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setFilters({ page: page > 2 ? page - 1 : undefined })}
          >
            <ChevronLeft /> ก่อนหน้า
          </Button>
          <span className="text-sm text-muted-foreground">หน้า {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!list.data.hasMore}
            onClick={() => setFilters({ page: page + 1 })}
          >
            ถัดไป <ChevronRight />
          </Button>
        </nav>
      )}

      {acting?.kind === "reject" && (
        <RejectDialog key={acting.item.id} item={acting.item} onClose={() => setActing(null)} />
      )}
      {acting?.kind === "edit" && (
        <EditDialog key={acting.item.id} item={acting.item} onClose={() => setActing(null)} />
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { value: T | null; label: string }[];
  value: T | null;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next: T | null) => onChange(next ?? undefined)}
    >
      <SelectTrigger aria-label={label} className="lg:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value ?? "all"} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RejectDialog({ item, onClose }: { item: AthleteItem; onClose: () => void }) {
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
      await api.review(item.id, { ...parsed.data, version: item.version });
      return true;
    },
    onSuccess: (done) => {
      if (!done) return;
      toast.success("ไม่อนุมัติแล้ว");
      onClose();
    },
    onError: (error) => toast.error(error.message),
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
            <DialogTitle>ไม่อนุมัติ {item.athlete.name}</DialogTitle>
            <DialogDescription>
              {item.sport.name} · {item.division.name} นักกีฬาจะเห็นเหตุผลนี้
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
            <Button type="submit" variant="destructive" disabled={reject.isPending}>
              ไม่อนุมัติ
            </Button>
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
  const institutionItems = INSTITUTIONS.map((entry) => ({ value: entry.id, label: entry.short }));

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
    onError: (error) => toast.error(error.message),
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
              <FieldLabel htmlFor="athlete-student-id">รหัสนักศึกษา</FieldLabel>
              <Input
                id="athlete-student-id"
                value={studentId}
                aria-invalid={!!issues.studentId}
                onChange={(event) => setStudentId(event.target.value)}
              />
              {issues.studentId && <FieldDescription>{issues.studentId}</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="athlete-institution">สถาบัน</FieldLabel>
              <Select
                items={institutionItems}
                value={institution}
                onValueChange={(value: Institution | null) => value && setInstitution(value)}
              >
                <SelectTrigger id="athlete-institution" aria-label="สถาบันของนักกีฬา">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {institutionItems.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button type="submit" disabled={save.isPending}>
              บันทึก
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
