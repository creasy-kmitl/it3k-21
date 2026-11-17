/** @jsxImportSource react */
import { Text } from "@react-email/components";
import {
  EmailLayout,
  type EmailContext,
  greeting,
  type InfoRow,
  InfoTable,
  mutedText,
  PrimaryButton,
  text,
} from "../components/layout";
import { formatEventTime } from "../format";
import type { TicketClaimedJob } from "../jobs";

export const ticketClaimedSubject = (job: TicketClaimedJob) => `ตั๋ว ${job.ticket.eventName} ของคุณ`;

export function TicketClaimedEmail({ job, ctx }: { job: TicketClaimedJob; ctx: EmailContext }) {
  const t = job.ticket;
  const rows: InfoRow[] = [
    { label: "กิจกรรม", value: t.eventName },
    { label: "วันเวลา", value: formatEventTime(t.startAt, t.endAt) },
  ];
  if (t.venue) rows.push({ label: "สถานที่", value: t.venue });

  return (
    <EmailLayout ctx={ctx} preview={`คุณได้รับตั๋ว ${t.eventName} แล้ว`} title="รับตั๋วเรียบร้อย">
      <Text style={text}>
        {greeting(job.to.name)} คุณได้รับตั๋วเข้าร่วมกิจกรรมนี้แล้ว เปิดหน้าตั๋วแล้วแสดง QR code ที่จุดเช็กอินในวันงาน
      </Text>
      <InfoTable rows={rows} />
      <PrimaryButton href={`${ctx.webOrigin}/tickets/${encodeURIComponent(t.ref)}`}>
        เปิดตั๋วของฉัน
      </PrimaryButton>
      <Text style={mutedText}>ตั๋วผูกกับบัญชีของคุณ ต้องเข้าสู่ระบบก่อนจึงจะเห็น QR code</Text>
    </EmailLayout>
  );
}
