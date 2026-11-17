/** @jsxImportSource react */
import { INSTITUTIONS } from "@it3k/db/profile";
import { STATUS_LABELS } from "@it3k/db/sport-rules";
import { Text } from "@react-email/components";
import {
  EmailLayout,
  type EmailContext,
  greeting,
  type InfoRow,
  InfoTable,
  PrimaryButton,
  StatusBadge,
  text,
} from "../components/layout";
import type { SportReviewedJob } from "../jobs";

export const sportReviewedSubject = (job: SportReviewedJob) =>
  job.registration.status === "approved"
    ? `ใบสมัคร${job.registration.sport} ได้รับการอนุมัติแล้ว`
    : `ใบสมัคร${job.registration.sport} ไม่ผ่านการอนุมัติ`;

export function SportReviewedEmail({ job, ctx }: { job: SportReviewedJob; ctx: EmailContext }) {
  const r = job.registration;
  const approved = r.status === "approved";
  const rows: InfoRow[] = [
    { label: "กีฬา", value: r.sport },
    { label: "ประเภท", value: r.division },
    {
      label: "สถาบัน",
      value: INSTITUTIONS.find((item) => item.id === r.institution)?.short ?? r.institution,
    },
    {
      label: "ผลการตรวจสอบ",
      value: (
        <StatusBadge tone={approved ? "success" : "danger"}>{STATUS_LABELS[r.status]}</StatusBadge>
      ),
    },
  ];
  if (r.note) rows.push({ label: "หมายเหตุจากฝ่ายทะเบียน", value: r.note });

  return (
    <EmailLayout
      ctx={ctx}
      preview={sportReviewedSubject(job)}
      title={approved ? "ใบสมัครได้รับการอนุมัติ" : "ใบสมัครไม่ผ่านการอนุมัติ"}
    >
      <Text style={text}>
        {greeting(job.to.name)}{" "}
        {approved
          ? `ฝ่ายทะเบียนอนุมัติใบสมัคร${r.sport}ของคุณแล้ว เตรียมตัวให้พร้อมสำหรับการแข่งขันได้เลย`
          : `ฝ่ายทะเบียนตรวจสอบใบสมัคร${r.sport}ของคุณแล้ว แต่ยังไม่ผ่านการอนุมัติ ดูหมายเหตุด้านล่างหรือติดต่อฝ่ายทะเบียนของสถาบัน`}
      </Text>
      <InfoTable rows={rows} />
      <PrimaryButton href={`${ctx.webOrigin}/sports`}>ดูการสมัครของฉัน</PrimaryButton>
    </EmailLayout>
  );
}
