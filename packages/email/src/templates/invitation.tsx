/** @jsxImportSource react */
import { Text } from "@react-email/components";
import type { AssignKind } from "@it3k/db/invitation-rules";
import { INSTITUTIONS } from "@it3k/db/profile";
import {
  EmailLayout,
  type EmailContext,
  type InfoRow,
  InfoTable,
  mutedText,
  PrimaryButton,
  text,
} from "../components/layout";
import type { InvitationJob } from "../jobs";

const KIND_LABELS: Record<AssignKind, string> = {
  guest: "Guest",
  participant: "ผู้เข้าร่วม",
  athlete: "นักกีฬา",
  staff: "Staff",
  head: "หัวหน้าฝ่าย",
  vicehead: "รองหัวหน้าฝ่าย",
};

const expiryFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const invitationSubject = () => "คุณได้รับคำเชิญเข้าใช้งาน";

export function InvitationEmail({ job, ctx }: { job: InvitationJob; ctx: EmailContext }) {
  const i = job.invite;
  const rows: InfoRow[] = [
    { label: "อีเมล", value: job.to.email },
    { label: "บทบาท", value: KIND_LABELS[i.kind] },
  ];
  if (i.department) rows.push({ label: "ฝ่าย", value: i.department });
  const institution = INSTITUTIONS.find((x) => x.id === i.institution);
  if (institution) rows.push({ label: "สถาบัน", value: institution.name });
  if (i.invitedBy) rows.push({ label: "เชิญโดย", value: i.invitedBy });
  rows.push({ label: "ใช้ได้ถึง", value: expiryFormat.format(i.expiresAt) });

  return (
    <EmailLayout ctx={ctx} preview="คุณได้รับคำเชิญเข้าใช้งาน IT3Kings" title="คำเชิญเข้าใช้งาน">
      <Text style={text}>
        สวัสดีครับ/ค่ะ คุณได้รับคำเชิญให้เข้าใช้งานระบบ เข้าสู่ระบบด้วยบัญชี Google ของอีเมลนี้
        แล้วบัญชีของคุณจะได้รับบทบาทด้านล่างทันที
      </Text>
      <InfoTable rows={rows} />
      <PrimaryButton href={`${ctx.webOrigin}/login`}>เข้าสู่ระบบด้วย Google</PrimaryButton>
      <Text style={mutedText}>
        ต้องใช้บัญชี Google ที่ใช้อีเมล {job.to.email} เท่านั้น ถ้าไม่ได้คาดว่าจะได้รับอีเมลนี้ ไม่ต้องทำอะไร
      </Text>
    </EmailLayout>
  );
}
