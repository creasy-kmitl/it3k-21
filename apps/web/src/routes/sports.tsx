import { INSTITUTIONS } from "@it3k/db/profile";
import { studentIdInput } from "@it3k/db/sport-rules";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import { Field, FieldDescription, FieldGroup } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@it3k/ui/lib/utils";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  IdCard,
  ImagePlus,
  Lock,
  Medal,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { SideDrawer } from "@/components/calendar/side-drawer";
import { FileLibrary } from "@/components/file-library";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { ParticipantShell } from "@/components/participant-shell";
import {
  type FieldIssues,
  IconLabel,
  RegistrationFieldsEditor,
  parseDraft,
  toDraft,
} from "@/components/registration-fields";
import { SportThumbnail } from "@/components/sport-art";
import { RegistrationRow, RegistrationRows } from "@/components/sport-registration-row";
import { DivisionTags, StatusBadge } from "@/components/sport-badges";
import { useApis } from "@/lib/api-context";
import { requireParticipantSession } from "@/lib/participant-auth";
import { publicFileUrl } from "@/lib/files";
import type { MyRegistration, MyRegistrations } from "@/lib/registrations";
import type { Division, Sport } from "@/lib/sports";
import { ErrorState } from "@/components/error-state";
import { toastError } from "@/lib/errors";

const searchSchema = z.object({
  // Better Auth sends people back here with ?error= when linking Discord fails.
  error: z.string().max(200).optional().catch(undefined),
});

export const Route = createFileRoute("/sports")({
  ssr: false,
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async ({ context, location }) => ({
    session: await requireParticipantSession(context.queryClient, location.href),
  }),
  head: () => ({
    meta: [{ title: "สมัครกีฬา · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const { error } = Route.useSearch();
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (!error) return;
    toast.error(
      error.includes("already") || error.includes("ALREADY")
        ? "บัญชี Discord นี้เชื่อมกับผู้ใช้อื่นอยู่แล้ว หรือคุณเชื่อม Discord ไว้แล้ว"
        : `เชื่อม Discord ไม่สำเร็จ (${error})`,
    );
    void navigate({ search: {}, replace: true });
  }, [error, navigate]);
  return (
    <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
      <SportsRegistrationPage userId={session.user.id} />
    </ParticipantShell>
  );
}

type Dialogs =
  | { kind: "register"; division: Division }
  | { kind: "edit"; registration: MyRegistration; division: Division }
  | { kind: "withdraw"; registration: MyRegistration };

/** Esports is the sport whose divisions need a game profile, and with it Discord. */
const isEsports = (sport: Sport) => sport.divisions.some((d) => d.requiresGameProfile);

/**
 * The sports matching `query`, by sport name, description or code, or by
 * division name. A sport that matches keeps all its divisions; otherwise only
 * the matching divisions stay.
 */
export function filterSports(sports: Sport[], query: string): Sport[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sports;
  const has = (text: string | null) => !!text && text.toLowerCase().includes(needle);
  return sports.flatMap((sport) => {
    if (has(sport.name) || has(sport.description) || has(sport.code)) return [sport];
    const divisions = sport.divisions.filter((d) => has(d.name) || has(d.code));
    return divisions.length > 0 ? [{ ...sport, divisions }] : [];
  });
}

/**
 * An athlete's registrations, with the sports to enroll in kept in a drawer
 * so the page is about what they have already signed up for.
 */
export function SportsRegistrationPage({ userId }: { userId: string }) {
  const { registrations: api, sports: sportsApi } = useApis();
  const me = useQuery({ queryKey: ["registrations", "me"], queryFn: () => api.me() });
  const sports = useQuery({ queryKey: ["sports"], queryFn: () => sportsApi.list() });
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [query, setQuery] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);

  if (me.isPending || sports.isPending) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">กำลังโหลด</span>
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (me.isError || sports.isError) {
    return (
      <ErrorState
        error={me.error ?? sports.error}
        onRetry={() => Promise.all([me.refetch(), sports.refetch()])}
        title="โหลดข้อมูลกีฬาไม่สำเร็จ"
      />
    );
  }

  const data = me.data;
  const divisions = new Map(
    sports.data.items.flatMap((sport) => sport.divisions.map((d) => [d.id, d] as const)),
  );
  const mine = new Map(data.registrations.map((r) => [r.divisionId, r] as const));
  const institution = INSTITUTIONS.find((item) => item.id === data.institution);
  const visible = filterSports(sports.data.items, query);
  const openCatalog = () => setCatalogOpen(true);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          icon={Medal}
          title="สมัครกีฬา"
          description={
            institution ? `สมัครในนาม ${institution.short} · สมัครได้หลายประเภท` : "สมัครได้หลายประเภท"
          }
        />
        <Button variant={data.profileSubmitted ? "default" : "outline"} onClick={openCatalog}>
          {data.profileSubmitted ? (
            <>
              <Plus data-icon="inline-start" aria-hidden /> สมัครกีฬา
            </>
          ) : (
            <>
              <Medal data-icon="inline-start" aria-hidden /> ดูประเภทกีฬา
            </>
          )}
        </Button>
      </div>

      {!data.profileSubmitted ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
          <UserRoundPlus className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">ลงทะเบียนผู้เข้าร่วมก่อน</span>
            <span className="text-sm text-muted-foreground">
              ส่งข้อมูลผู้เข้าร่วมให้ครบ แล้วกลับมาสมัครกีฬาได้ที่หน้านี้
            </span>
          </div>
          <Button size="sm" render={<Link to="/signup" />} nativeButton={false}>
            ไปลงทะเบียน
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Button>
        </div>
      ) : (
        <MyRegistrationList
          registrations={data.registrations}
          onBrowse={openCatalog}
          onEdit={(registration) => {
            const division = divisions.get(registration.divisionId);
            if (division) setDialog({ kind: "edit", registration, division });
          }}
          onWithdraw={(registration) => setDialog({ kind: "withdraw", registration })}
        />
      )}

      <SideDrawer
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        title="เลือกกีฬาที่จะสมัคร"
        description={institution ? `สมัครในนาม ${institution.short}` : undefined}
        width="44rem"
      >
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="ค้นหากีฬา"
              placeholder="ค้นหากีฬาหรือประเภท เช่น ฟุตบอล, ROV, หญิง"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {visible.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">ไม่พบกีฬาที่ตรงกับ “{query.trim()}”</p>
          ) : (
            // Columns rather than a grid, so a sport with many divisions does
            // not leave a hole next to a short one.
            <ul className="columns-1 gap-3 sm:columns-2">
              {visible.map((sport) => (
                <li
                  key={sport.id}
                  className="mb-3 flex break-inside-avoid flex-col overflow-hidden rounded-2xl border bg-card"
                >
                  <div className="flex items-center gap-3 p-3">
                    <SportThumbnail
                      src={sport.thumbnailUrl}
                      icon={sport.icon}
                      seed={sport.id}
                      label={sport.name}
                      className="aspect-square size-10 w-10 shrink-0 rounded-xl"
                    />
                    <div className="flex min-w-0 flex-col">
                      <h2 className="truncate font-semibold">{sport.name}</h2>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {sport.description || `${sport.divisions.length} ประเภท`}
                      </p>
                    </div>
                  </div>
                  <ul className="flex flex-col divide-y border-t">
                    {sport.divisions.map((division) => (
                      <DivisionRow
                        key={division.id}
                        division={division}
                        registration={mine.get(division.id) ?? null}
                        approved={data.institution ? (data.approvedCounts[division.id] ?? 0) : null}
                        canRegister={data.profileSubmitted}
                        onRegister={() => {
                          // The form takes over from the drawer; the new entry
                          // then shows on the page.
                          setCatalogOpen(false);
                          setDialog({ kind: "register", division });
                        }}
                      />
                    ))}
                  </ul>
                  {isEsports(sport) && data.profileSubmitted && (
                    <DiscordBar discord={data.discord} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SideDrawer>

      {dialog?.kind === "withdraw" ? (
        <WithdrawDialog registration={dialog.registration} onClose={() => setDialog(null)} />
      ) : dialog ? (
        <RegistrationDialog
          key={dialog.kind === "edit" ? dialog.registration.id : dialog.division.id}
          division={dialog.division}
          registration={dialog.kind === "edit" ? dialog.registration : null}
          userId={userId}
          remembered={{ studentId: data.studentId, studentCardFileId: data.studentCardFileId }}
          discord={data.discord}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function DivisionRow({
  division,
  registration,
  approved,
  canRegister,
  onRegister,
}: {
  division: Division;
  registration: MyRegistration | null;
  /** Approved at the athlete's institution, or null when it is not known yet. */
  approved: number | null;
  canRegister: boolean;
  onRegister: () => void;
}) {
  const max = division.maxPerInstitution;
  const full = approved !== null && max !== null && approved >= max;
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{division.name}</span>
        <DivisionTags division={division} className="mt-1" />
        {/* Applying stays open when full: registration staff pick who is approved. */}
        {approved !== null && max !== null && (
          <span
            className={cn(
              "text-xs tabular-nums",
              full ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {full ? `อนุมัติครบ ${max} คนแล้ว` : `อนุมัติแล้ว ${approved}/${max} คน`}
          </span>
        )}
      </div>
      {registration ? (
        <StatusBadge status={registration.status} />
      ) : !division.registrationOpen ? (
        <Badge variant="outline">
          <Lock aria-hidden /> ปิดรับ
        </Badge>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={!canRegister}
          aria-label={`สมัคร ${division.name}`}
          onClick={onRegister}
        >
          สมัคร
        </Button>
      )}
    </li>
  );
}

function MyRegistrationList({
  registrations,
  onBrowse,
  onEdit,
  onWithdraw,
}: {
  registrations: MyRegistration[];
  onBrowse: () => void;
  onEdit: (registration: MyRegistration) => void;
  onWithdraw: (registration: MyRegistration) => void;
}) {
  if (registrations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
        <Medal className="size-8 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-medium">ยังไม่ได้สมัครกีฬา</p>
          <p className="text-sm text-muted-foreground">
            เลือกได้หลายประเภท ฝ่ายทะเบียนจะตรวจสอบและแจ้งผลที่นี่
          </p>
        </div>
        <Button onClick={onBrowse}>
          เลือกกีฬาที่จะสมัคร
          <ArrowRight data-icon="inline-end" aria-hidden />
        </Button>
      </div>
    );
  }
  return (
    <section aria-labelledby="my-registrations" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="my-registrations" className="font-semibold">
          การสมัครของฉัน ({registrations.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          แก้ไขหรือถอนได้ระหว่างรอตรวจสอบ หลังจากนั้นติดต่อฝ่ายทะเบียน
        </p>
      </div>
      <RegistrationRows>
        {registrations.map((registration) => (
          <RegistrationRow
            key={registration.id}
            registration={registration}
            actions={
              registration.status === "review" && (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`แก้ไข ${registration.division.name}`}
                    onClick={() => onEdit(registration)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`ถอน ${registration.division.name}`}
                    onClick={() => onWithdraw(registration)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </>
              )
            }
          />
        ))}
      </RegistrationRows>
    </section>
  );
}

function useLinkDiscord() {
  const { registrations: api } = useApis();
  return useMutation({
    mutationFn: () => api.linkDiscord(`${window.location.origin}/sports`),
    onError: (error) => toastError(error, "เชื่อม Discord ไม่สำเร็จ"),
  });
}

/** Discord status at the foot of the esports card, the only sport that needs it. */
function DiscordBar({ discord }: { discord: MyRegistrations["discord"] }) {
  const { registrations: api } = useApis();
  const queryClient = useQueryClient();
  const link = useLinkDiscord();
  const unlink = useMutation({
    mutationFn: (accountId: string) => api.unlinkDiscord(accountId),
    onSuccess: () => toast.success("ยกเลิกการเชื่อม Discord แล้ว"),
    onError: (error) => toastError(error, "ยกเลิกการเชื่อม Discord ไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["registrations"] }),
  });
  const linked = discord.linked;

  return (
    <div className="flex items-center gap-2 border-t bg-muted/50 px-3 py-2 text-sm">
      <MessageCircle className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 text-muted-foreground">
        {!discord.enabled
          ? "ยังไม่เปิดให้เชื่อม Discord"
          : linked
            ? `เชื่อมแล้ว${linked.username ? `: ${linked.username}` : ""}`
            : "ต้องเชื่อม Discord ก่อนสมัคร"}
      </span>
      {discord.enabled &&
        (linked ? (
          <LoadingButton
            variant="ghost"
            size="sm"
            title="จะเปลี่ยนบัญชี ให้ยกเลิกแล้วเชื่อมใหม่"
            loading={unlink.isPending}
            onClick={() => unlink.mutate(linked.accountId)}
          >
            ยกเลิกการเชื่อม
          </LoadingButton>
        ) : (
          <LoadingButton size="sm" loading={link.isPending} onClick={() => link.mutate()}>
            เชื่อม Discord
          </LoadingButton>
        ))}
    </div>
  );
}

function RegistrationDialog({
  division,
  registration,
  userId,
  remembered,
  discord,
  onClose,
}: {
  division: Division;
  registration: MyRegistration | null;
  userId: string;
  /** The student id and card from the last registration, filled in ready to change. */
  remembered: Pick<MyRegistrations, "studentId" | "studentCardFileId">;
  discord: MyRegistrations["discord"];
  onClose: () => void;
}) {
  const { registrations: api } = useApis();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(registration ?? {}));
  const [studentId, setStudentId] = useState(remembered.studentId ?? "");
  const [cardId, setCardId] = useState(
    registration?.studentCardFileId ?? remembered.studentCardFileId,
  );
  const [pickingCard, setPickingCard] = useState(false);
  const [issues, setIssues] = useState<
    FieldIssues & { studentId?: string; studentCardFileId?: string }
  >({});
  const needsDiscord = division.requiresGameProfile && !discord.linked;
  const link = useLinkDiscord();

  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseDraft(division, draft);
      const id = studentIdInput.safeParse(studentId);
      if (!parsed.ok || !id.success || !cardId) {
        setIssues({
          ...(parsed.ok ? {} : parsed.issues),
          ...(id.success ? {} : { studentId: id.error.issues[0]?.message }),
          ...(cardId ? {} : { studentCardFileId: "แนบรูปบัตรนักศึกษา" }),
        });
        return false;
      }
      setIssues({});
      const card = { studentId: id.data, studentCardFileId: cardId };
      if (registration) {
        await api.update(registration.id, {
          ...parsed.fields,
          ...card,
          version: registration.version,
        });
      } else {
        await api.register({ ...parsed.fields, ...card, divisionId: division.id });
      }
      return true;
    },
    onSuccess: (saved) => {
      if (!saved) return;
      toast.success(registration ? "บันทึกแล้ว" : `สมัคร ${division.name} แล้ว รอฝ่ายทะเบียนตรวจสอบ`);
      onClose();
    },
    onError: (error) => toastError(error, "บันทึกการสมัครไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["registrations"] }),
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
            <DialogTitle>
              {registration ? `แก้ไข ${division.name}` : `สมัคร ${division.name}`}
            </DialogTitle>
            <DialogDescription>ฝ่ายทะเบียนจะตรวจสอบและแจ้งผลในหน้านี้</DialogDescription>
          </DialogHeader>
          {needsDiscord && (
            <div className="flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-sm">
              <MessageCircle className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                {discord.enabled
                  ? "ต้องเชื่อม Discord ก่อนสมัคร แล้วกลับมาที่หน้านี้"
                  : "ยังไม่เปิดให้เชื่อม Discord จึงยังสมัครประเภทนี้ไม่ได้"}
              </span>
              {discord.enabled && (
                <LoadingButton
                  type="button"
                  size="sm"
                  loading={link.isPending}
                  onClick={() => link.mutate()}
                >
                  เชื่อม Discord
                </LoadingButton>
              )}
            </div>
          )}
          <FieldGroup>
            <Field data-invalid={!!issues.studentId}>
              <IconLabel htmlFor="registration-student-id" icon={IdCard}>
                รหัสนักศึกษา
              </IconLabel>
              <Input
                id="registration-student-id"
                value={studentId}
                aria-invalid={!!issues.studentId}
                onChange={(event) => setStudentId(event.target.value)}
              />
              <FieldDescription>
                {issues.studentId ??
                  (remembered.studentId
                    ? "กรอกให้จากครั้งก่อนแล้ว แก้ได้ถ้าไม่ถูกต้อง"
                    : "ระบบจะจำไว้ให้ ครั้งต่อไปไม่ต้องกรอกใหม่")}
              </FieldDescription>
            </Field>
            <Field data-invalid={!!issues.studentCardFileId}>
              <IconLabel htmlFor="registration-student-card" icon={IdCard}>
                รูปบัตรนักศึกษา
              </IconLabel>
              {cardId ? (
                <img
                  src={publicFileUrl(cardId)}
                  alt="รูปบัตรนักศึกษาที่แนบ"
                  className="aspect-[1.586] w-full rounded-xl border bg-muted object-contain"
                />
              ) : (
                <div className="flex aspect-[1.586] w-full items-center justify-center rounded-xl border border-dashed bg-muted">
                  <ImagePlus className="size-10 text-muted-foreground" aria-hidden />
                </div>
              )}
              <Button
                id="registration-student-card"
                type="button"
                variant="outline"
                aria-label={cardId ? "เปลี่ยนรูปบัตรนักศึกษา" : "แนบรูปบัตรนักศึกษา"}
                aria-invalid={!!issues.studentCardFileId}
                onClick={() => setPickingCard(true)}
              >
                <ImagePlus data-icon="inline-start" aria-hidden />
                {cardId ? "เปลี่ยนรูปบัตร" : "แนบรูปบัตร"}
              </Button>
              <FieldDescription>
                {issues.studentCardFileId ??
                  (cardId && !registration?.studentCardFileId && remembered.studentCardFileId
                    ? "ใช้รูปจากการสมัครครั้งก่อน เปลี่ยนได้ถ้าไม่ใช่บัตรปัจจุบัน"
                    : "ต้องแนบทุกครั้งที่สมัคร ให้เห็นชื่อ รหัส และรูปบนบัตรชัดเจน")}
              </FieldDescription>
              {pickingCard && (
                <FileLibrary
                  userId={userId}
                  selectTitle="เลือกรูปบัตรนักศึกษา"
                  selectHint="ด้านหน้าบัตร เห็นชื่อ รหัส และรูปชัดเจน"
                  onClose={() => setPickingCard(false)}
                  onSelect={(file) => {
                    setCardId(file.id);
                    setIssues((previous) => ({ ...previous, studentCardFileId: undefined }));
                    setPickingCard(false);
                  }}
                />
              )}
            </Field>
            <RegistrationFieldsEditor
              division={division}
              draft={draft}
              issues={issues}
              onChange={setDraft}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton type="submit" loading={save.isPending} disabled={needsDiscord}>
              {registration ? "บันทึก" : "สมัคร"}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  registration,
  onClose,
}: {
  registration: MyRegistration;
  onClose: () => void;
}) {
  const { registrations: api } = useApis();
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: () => api.withdraw(registration.id, registration.version),
    onSuccess: () => {
      toast.success("ถอนการสมัครแล้ว");
      onClose();
    },
    onError: (error) => toastError(error, "ถอนการสมัครไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["registrations"] }),
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ถอนการสมัคร {registration.division.name}?</AlertDialogTitle>
          <AlertDialogDescription>สมัครใหม่ได้ภายหลังถ้ายังเปิดรับสมัคร</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            loading={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            ถอน
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
