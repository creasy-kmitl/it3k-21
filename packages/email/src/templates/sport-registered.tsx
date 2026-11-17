/** @jsxImportSource react */
import { INSTITUTIONS } from "@it3k/db/profile";
import { FORMAT_LABELS, GENDER_LABELS, STATUS_LABELS } from "@it3k/db/sport-rules";
import { Text } from "@react-email/components";
import {
  EmailLayout,
  type EmailContext,
  greeting,
  type InfoRow,
  InfoTable,
  mutedText,
  PrimaryButton,
  StatusBadge,
  text,
} from "../components/layout";
import type { SportRegisteredJob } from "../jobs";

export const sportRegisteredSubject = (job: SportRegisteredJob) =>
  `ส่งใบสมัคร${job.registration.sport} (${job.registration.division}) แล้ว`;

export function SportRegisteredEmail({ job, ctx }: { job: SportRegisteredJob; ctx: EmailContext }) {
  const r = job.registration;
  const rows: InfoRow[] = [
    { label: "กีฬา", value: r.sport },
    { label: "ประเภท", value: r.division },
    { label: "รูปแบบ", value: `${FORMAT_LABELS[r.format]} · ${GENDER_LABELS[r.gender]}` },
    {
      label: "สถาบัน",
      value: INSTITUTIONS.find((item) => item.id === r.institution)?.short ?? r.institution,
    },
    { label: "สถานะ", value: <StatusBadge tone="neutral">{STATUS_LABELS[r.status]}</StatusBadge> },
  ];
  if (r.shirtNumber != null) rows.push({ label: "หมายเลขเสื้อ", value: String(r.shirtNumber) });
  if (r.badmintonRank != null) rows.push({ label: "มือ", value: `มือ ${r.badmintonRank}` });
  if (r.ign) rows.push({ label: "ชื่อในเกม", value: r.ign });

  return (
    <EmailLayout ctx={ctx} preview={`ใบสมัคร${r.sport} รอตรวจสอบจากฝ่ายทะเบียน`} title="ส่งใบสมัครแล้ว">
      <Text style={text}>
        {greeting(job.to.name)} เราได้รับใบสมัครของคุณแล้ว ตอนนี้อยู่ระหว่างรอฝ่ายทะเบียนตรวจสอบ
        และจะแจ้งผลทางอีเมลอีกครั้ง
      </Text>
      <InfoTable rows={rows} />
      <PrimaryButton href={`${ctx.webOrigin}/sports`}>ดูการสมัครของฉัน</PrimaryButton>
      <Text style={mutedText}>แก้ไขหรือถอนการสมัครได้จากหน้ากีฬา จนกว่าฝ่ายทะเบียนจะตรวจสอบ</Text>
    </EmailLayout>
  );
}
