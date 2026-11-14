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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@it3k/ui/components/card";
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
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Lock,
  Medal,
  MessageCircle,
  Pencil,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { ParticipantShell } from "@/components/participant-shell";
import {
  type FieldIssues,
  RegistrationFieldsEditor,
  parseDraft,
  toDraft,
} from "@/components/registration-fields";
import { SportThumbnail } from "@/components/sport-art";
import { DivisionBadges, StatusBadge } from "@/components/sport-badges";
import { useApis } from "@/lib/api-context";
import { requireParticipantSession } from "@/lib/participant-auth";
import type { MyRegistration, MyRegistrations } from "@/lib/registrations";
import type { Division, Sport } from "@/lib/sports";

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
      <SportsRegistrationPage />
    </ParticipantShell>
  );
}

type Dialogs =
  | { kind: "register"; sport: Sport; division: Division }
  | { kind: "edit"; registration: MyRegistration; division: Division }
  | { kind: "withdraw"; registration: MyRegistration };

/** An athlete's registrations and the sports open to register for. */
export function SportsRegistrationPage() {
  const { registrations: api, sports: sportsApi } = useApis();
  const me = useQuery({ queryKey: ["registrations", "me"], queryFn: () => api.me() });
  const sports = useQuery({ queryKey: ["sports"], queryFn: () => sportsApi.list() });
  const [dialog, setDialog] = useState<Dialogs | null>(null);

  if (me.isPending || sports.isPending) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">กำลังโหลด</span>
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (me.isError || sports.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
        <p>โหลดข้อมูลไม่สำเร็จ: {(me.error ?? sports.error)?.message}</p>
        <Button
          variant="outline"
          onClick={() => void Promise.all([me.refetch(), sports.refetch()])}
        >
          ลองอีกครั้ง
        </Button>
      </div>
    );
  }

  const data = me.data;
  const divisions = new Map(
    sports.data.items.flatMap((sport) => sport.divisions.map((d) => [d.id, d] as const)),
  );
  const registered = new Set(data.registrations.map((r) => r.divisionId));
  const institution = INSTITUTIONS.find((item) => item.id === data.institution);
  const hasEsports = sports.data.items.some((s) => s.divisions.some((d) => d.requiresGameProfile));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Medal}
        title="สมัครกีฬา"
        description={
          institution ? `สมัครในนาม ${institution.short} · สมัครได้หลายประเภท` : "สมัครได้หลายประเภท"
        }
      />

      {!data.profileSubmitted ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRoundPlus className="size-5 text-primary" aria-hidden />
              ลงทะเบียนผู้เข้าร่วมก่อน
            </CardTitle>
            <CardDescription>ส่งข้อมูลผู้เข้าร่วมให้ครบ แล้วกลับมาสมัครกีฬาได้ที่หน้านี้</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/signup" />} nativeButton={false}>
              ไปลงทะเบียน
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <MyRegistrationList
            registrations={data.registrations}
            onEdit={(registration) => {
              const division = divisions.get(registration.divisionId);
              if (division) setDialog({ kind: "edit", registration, division });
            }}
            onWithdraw={(registration) => setDialog({ kind: "withdraw", registration })}
          />
          {hasEsports && <DiscordCard discord={data.discord} />}
        </>
      )}

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sports.data.items.map((sport) => (
          <li key={sport.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
            <SportThumbnail
              src={sport.thumbnailUrl}
              icon={sport.icon}
              seed={sport.id}
              label={sport.name}
            />
            <h2 className="p-4 pb-2 font-semibold">{sport.name}</h2>
            {sport.description && (
              <p className="px-4 pb-2 text-sm text-muted-foreground">{sport.description}</p>
            )}
            <ul className="flex flex-1 flex-col divide-y border-t">
              {sport.divisions.map((division) => {
                const already = registered.has(division.id);
                return (
                  <li key={division.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="font-medium">{division.name}</span>
                      <DivisionBadges division={division} />
                    </div>
                    {already ? (
                      <Badge variant="outline">สมัครแล้ว</Badge>
                    ) : !division.registrationOpen ? (
                      <Badge variant="outline">
                        <Lock aria-hidden /> ปิดรับสมัคร
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={!data.profileSubmitted}
                        aria-label={`สมัคร ${division.name}`}
                        onClick={() => setDialog({ kind: "register", sport, division })}
                      >
                        สมัคร
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {dialog?.kind === "withdraw" ? (
        <WithdrawDialog registration={dialog.registration} onClose={() => setDialog(null)} />
      ) : dialog ? (
        <RegistrationDialog
          key={dialog.kind === "edit" ? dialog.registration.id : dialog.division.id}
          division={dialog.division}
          registration={dialog.kind === "edit" ? dialog.registration : null}
          askStudentId={!data.studentId}
          discord={data.discord}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function MyRegistrationList({
  registrations,
  onEdit,
  onWithdraw,
}: {
  registrations: MyRegistration[];
  onEdit: (registration: MyRegistration) => void;
  onWithdraw: (registration: MyRegistration) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>การสมัครของฉัน</CardTitle>
        <CardDescription>
          {registrations.length === 0
            ? "ยังไม่ได้สมัครกีฬา เลือกประเภทที่ต้องการด้านล่าง"
            : "แก้ไขหรือถอนได้ระหว่างรอตรวจสอบ หลังจากนั้นติดต่อฝ่ายทะเบียน"}
        </CardDescription>
      </CardHeader>
      {registrations.length > 0 && (
        <CardContent>
          <ul className="flex flex-col divide-y">
            {registrations.map((registration) => (
              <li key={registration.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">
                    {registration.sport.name} · {registration.division.name}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <StatusBadge status={registration.status} />
                    {registration.shirtNumber !== null && (
                      <span>เบอร์ {registration.shirtNumber}</span>
                    )}
                    {registration.badmintonRank !== null && (
                      <span>มือ {registration.badmintonRank}</span>
                    )}
                    {registration.ign && <span>IGN {registration.ign}</span>}
                  </span>
                  {registration.reviewNote && (
                    <p className="text-sm text-destructive">เหตุผล: {registration.reviewNote}</p>
                  )}
                </div>
                {registration.status === "review" && (
                  <div className="flex">
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
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function DiscordCard({ discord }: { discord: MyRegistrations["discord"] }) {
  const { registrations: api } = useApis();
  const queryClient = useQueryClient();
  const link = useMutation({
    mutationFn: () => api.linkDiscord(`${window.location.origin}/sports`),
    onError: (error) => toast.error(error.message),
  });
  const unlink = useMutation({
    mutationFn: (accountId: string) => api.unlinkDiscord(accountId),
    onSuccess: () => toast.success("ยกเลิกการเชื่อม Discord แล้ว"),
    onError: (error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["registrations"] }),
  });
  const linked = discord.linked;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-5 text-primary" aria-hidden />
          Discord
        </CardTitle>
        <CardDescription>
          {!discord.enabled
            ? "ยังไม่เปิดให้เชื่อม Discord"
            : linked
              ? `เชื่อมแล้ว${linked.username ? `: ${linked.username}` : ""}`
              : "ต้องเชื่อม Discord ก่อนสมัครกีฬา Esports (เชื่อมได้ 1 บัญชี)"}
        </CardDescription>
        {discord.enabled && (
          <CardAction className="flex gap-2">
            {linked ? (
              <Button
                variant="outline"
                size="sm"
                disabled={unlink.isPending}
                onClick={() => unlink.mutate(linked.accountId)}
              >
                ยกเลิกการเชื่อม
              </Button>
            ) : (
              <Button size="sm" disabled={link.isPending} onClick={() => link.mutate()}>
                เชื่อม Discord
              </Button>
            )}
          </CardAction>
        )}
      </CardHeader>
      {linked && discord.enabled && (
        <CardContent className="text-sm text-muted-foreground">
          จะเปลี่ยนบัญชี ให้ยกเลิกการเชื่อมแล้วเชื่อมบัญชีใหม่ การสมัครที่ส่งไปแล้วจะอัปเดตเมื่อแก้ไขครั้งถัดไป
        </CardContent>
      )}
    </Card>
  );
}

function RegistrationDialog({
  division,
  registration,
  askStudentId,
  discord,
  onClose,
}: {
  division: Division;
  registration: MyRegistration | null;
  askStudentId: boolean;
  discord: MyRegistrations["discord"];
  onClose: () => void;
}) {
  const { registrations: api } = useApis();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(registration ?? {}));
  const [studentId, setStudentId] = useState("");
  const [issues, setIssues] = useState<FieldIssues & { studentId?: string }>({});
  const needsDiscord = division.requiresGameProfile && !discord.linked;

  const save = useMutation({
    mutationFn: async () => {
      const parsed = parseDraft(division, draft);
      const id = askStudentId && !registration ? studentIdInput.safeParse(studentId) : null;
      if (!parsed.ok || (id && !id.success)) {
        setIssues({
          ...(parsed.ok ? {} : parsed.issues),
          ...(id && !id.success ? { studentId: id.error.issues[0]?.message } : {}),
        });
        return false;
      }
      setIssues({});
      if (registration) {
        await api.update(registration.id, { ...parsed.fields, version: registration.version });
      } else {
        await api.register({
          ...parsed.fields,
          divisionId: division.id,
          ...(id?.success ? { studentId: id.data } : {}),
        });
      }
      return true;
    },
    onSuccess: (saved) => {
      if (!saved) return;
      toast.success(registration ? "บันทึกแล้ว" : `สมัคร ${division.name} แล้ว รอฝ่ายทะเบียนตรวจสอบ`);
      onClose();
    },
    onError: (error) => toast.error(error.message),
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
            <DialogDescription>
              {needsDiscord
                ? "เชื่อม Discord ในหน้านี้ก่อน แล้วกลับมาสมัคร"
                : "ฝ่ายทะเบียนจะตรวจสอบและแจ้งผลในหน้านี้"}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {askStudentId && !registration && (
              <Field data-invalid={!!issues.studentId}>
                <FieldLabel htmlFor="registration-student-id">รหัสนักศึกษา</FieldLabel>
                <Input
                  id="registration-student-id"
                  value={studentId}
                  aria-invalid={!!issues.studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                />
                <FieldDescription>
                  {issues.studentId ?? "กรอกครั้งเดียว ใช้กับทุกประเภทที่สมัคร"}
                </FieldDescription>
              </Field>
            )}
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
            <Button type="submit" disabled={save.isPending || needsDiscord}>
              {registration ? "บันทึก" : "สมัคร"}
            </Button>
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
    onError: (error) => toast.error(error.message),
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
          <Button
            variant="destructive"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            ถอน
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
