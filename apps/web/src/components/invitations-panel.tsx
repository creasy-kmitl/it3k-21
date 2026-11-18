// Invitations let someone outside the institution email domains sign in with
// Google for the first time. The API decides who may invite as what; the
// kinds it lists are the only ones offered here.
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { type AssignKind, needsDepartment } from "@it3k/db/invitation-rules";
import {
  INSTITUTIONS,
  type Institution,
  SELF_SIGNUP_DOMAINS,
  suggestedInstitution,
} from "@it3k/db/profile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, GraduationCap, Mail, MailPlus, RotateCw, Shield, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DepartmentLabel } from "@/components/department-icon";
import { ErrorState } from "@/components/error-state";
import { ChoiceField, FormDialog, TextField } from "@/components/form-dialog";
import { LoadingButton } from "@/components/loading-button";
import { ROLE_BADGES } from "@/components/role-badge";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import type { Invitation, InvitationsApi } from "@/lib/invitations";
import { ApiError, type LeadershipDepartment } from "@/lib/leadership";

const STATUS_LABELS: Record<Invitation["status"], string> = {
  pending: "รอเข้าใช้งาน",
  expired: "หมดอายุ",
  accepted: "เข้าใช้งานแล้ว",
  revoked: "ยกเลิกแล้ว",
};

const NO_INSTITUTION = "none";

function InstitutionLabel({ institution }: { institution: (typeof INSTITUTIONS)[number] }) {
  return (
    <span className="flex items-center gap-2">
      <img src={institution.logo} alt="" className="size-4 shrink-0 object-contain" />
      {institution.short}
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function InvitationsPanel({ departments }: { departments: LeadershipDepartment[] }) {
  const { invitations: api } = useApis();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const list = useQuery({ queryKey: ["invitations"], queryFn: () => api.list() });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["invitations"] });
  const resend = useMutation({
    mutationFn: (id: string) => api.resend(id),
    onSuccess: (invite) => toast.success(`ส่งคำเชิญถึง ${invite.email} อีกครั้งแล้ว`),
    onError: (error) => toastError(error, "ส่งคำเชิญไม่สำเร็จ"),
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revoke(id),
    onSuccess: (invite) => toast.success(`ยกเลิกคำเชิญของ ${invite.email} แล้ว`),
    onError: (error) => toastError(error, "ยกเลิกคำเชิญไม่สำเร็จ"),
    onSettled: refresh,
  });

  const kinds = list.data?.assignableKinds ?? [];

  return (
    <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="invitations-heading" className="font-medium">
            คำเชิญ
          </h2>
          <p className="text-sm text-muted-foreground">
            อีเมล {SELF_SIGNUP_DOMAINS.map((d) => `@${d}`).join(", ")} เข้าใช้งานเองได้
            อีเมลอื่นต้องได้รับคำเชิญ
          </p>
        </div>
        <Button size="sm" disabled={kinds.length === 0} onClick={() => setInviting(true)}>
          <MailPlus /> เชิญผู้ใช้
        </Button>
      </div>

      {list.isPending ? (
        <div role="status">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-12 w-full" />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} title="โหลดคำเชิญไม่สำเร็จ" />
      ) : list.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีคำเชิญ</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border" aria-label="คำเชิญ">
          {list.data.items.map((invite) => (
            <li key={invite.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">{invite.email}</span>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline">{ROLE_BADGES[invite.kind].label}</Badge>
                  {invite.department && <span>{invite.department.name}</span>}
                  {invite.institution && (
                    <span>{INSTITUTIONS.find((i) => i.id === invite.institution)?.short}</span>
                  )}
                  <Badge variant={invite.status === "pending" ? "secondary" : "outline"}>
                    {STATUS_LABELS[invite.status]}
                  </Badge>
                  <span>
                    {invite.status === "pending" || invite.status === "expired"
                      ? `ใช้ได้ถึง ${dateFormat.format(invite.expiresAt)}`
                      : `ส่งเมื่อ ${dateFormat.format(invite.createdAt)}`}
                    {invite.invitedBy && ` · โดย ${invite.invitedBy}`}
                  </span>
                </div>
              </div>
              {invite.canManage && (
                <>
                  <LoadingButton
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`ส่งคำเชิญถึง ${invite.email} อีกครั้ง`}
                    title="ส่งอีกครั้ง"
                    icon={RotateCw}
                    loading={resend.isPending && resend.variables === invite.id}
                    onClick={() => resend.mutate(invite.id)}
                  />
                  <LoadingButton
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`ยกเลิกคำเชิญของ ${invite.email}`}
                    title="ยกเลิกคำเชิญ"
                    icon={X}
                    loading={revoke.isPending && revoke.variables === invite.id}
                    onClick={() => revoke.mutate(invite.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {inviting && (
        <InviteDialog
          api={api}
          kinds={kinds}
          canSetInstitution={list.data?.canSetInstitution ?? false}
          departments={departments}
          onClose={() => setInviting(false)}
          onSent={refresh}
        />
      )}
    </section>
  );
}

function InviteDialog({
  api,
  kinds,
  canSetInstitution,
  departments,
  onClose,
  onSent,
}: {
  api: InvitationsApi;
  kinds: AssignKind[];
  /** The API refuses an institution from anyone who may not set one on an account. */
  canSetInstitution: boolean;
  departments: LeadershipDepartment[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<AssignKind>(kinds[0] ?? "guest");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  // Follows the address's domain (kmitl.ac.th, kmutt.ac.th) until picked by hand.
  const [pickedInstitution, setPickedInstitution] = useState<Institution | null | undefined>();
  const institution =
    pickedInstitution === undefined ? suggestedInstitution(email) || null : pickedInstitution;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const withDepartment = needsDepartment(kind);

  const send = useMutation({
    mutationFn: () =>
      api.create({
        email,
        kind,
        departmentId: withDepartment ? departmentId : null,
        ...(canSetInstitution ? { institution } : {}),
      }),
    onSuccess: (invite) => {
      toast.success(`ส่งคำเชิญถึง ${invite.email} แล้ว`);
      onSent();
      onClose();
    },
    onError: (error) => {
      const issues = (error instanceof ApiError ? error.body : null) as {
        issues?: { path: string[]; message: string }[];
      } | null;
      if (issues?.issues?.length) {
        setErrors(Object.fromEntries(issues.issues.map((i) => [String(i.path[0]), i.message])));
        return;
      }
      toastError(error, "ส่งคำเชิญไม่สำเร็จ");
    },
  });

  return (
    <FormDialog
      title="เชิญผู้ใช้"
      icon={MailPlus}
      description="ผู้รับต้องเข้าสู่ระบบด้วยบัญชี Google ของอีเมลนี้ภายใน 14 วัน"
      pending={send.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (!email.trim()) {
          setErrors({ email: "กรอกอีเมล" });
          return;
        }
        setErrors({});
        send.mutate();
      }}
    >
      <TextField
        id="invite-email"
        label="อีเมล"
        icon={Mail}
        type="email"
        autoComplete="off"
        maxLength={254}
        value={email}
        error={errors.email}
        onChange={setEmail}
      />
      <ChoiceField
        id="invite-kind"
        label="บทบาท"
        icon={Shield}
        value={kind}
        options={kinds.map((value) => ({
          value,
          label: ROLE_BADGES[value].label,
          icon: ROLE_BADGES[value].icon,
        }))}
        onChange={setKind}
      />
      {withDepartment && (
        <ChoiceField
          id="invite-department"
          label="ฝ่าย"
          icon={Building2}
          value={departmentId}
          options={departments.map((d) => ({
            value: d.id,
            label: d.name,
            content: <DepartmentLabel department={d} />,
          }))}
          onChange={setDepartmentId}
        />
      )}
      {errors.departmentId && <p className="text-sm text-destructive">{errors.departmentId}</p>}
      {canSetInstitution && (
        <ChoiceField
          id="invite-institution"
          label="สถาบัน"
          icon={GraduationCap}
          value={institution ?? NO_INSTITUTION}
          options={[
            { value: NO_INSTITUTION, label: "ไม่ระบุ" },
            ...INSTITUTIONS.map((i) => ({
              value: i.id,
              label: i.short,
              content: <InstitutionLabel institution={i} />,
            })),
          ]}
          onChange={(value) =>
            setPickedInstitution(value === NO_INSTITUTION ? null : (value as Institution))
          }
        />
      )}
    </FormDialog>
  );
}
