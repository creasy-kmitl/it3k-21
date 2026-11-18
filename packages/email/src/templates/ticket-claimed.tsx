/** @jsxImportSource react */
import { Img, Section, Text } from "@react-email/components";
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
import { theme } from "../theme";

export const ticketClaimedSubject = (job: TicketClaimedJob) => `ตั๋ว ${job.ticket.eventName} ของคุณ`;

/**
 * `qrSrc` is where the QR image comes from: a `cid:` reference to an inline
 * attachment when sent, a data URL in the preview, or nothing for an old job
 * without a code.
 */
export function TicketClaimedEmail({
  job,
  ctx,
  qrSrc,
}: {
  job: TicketClaimedJob;
  ctx: EmailContext;
  qrSrc?: string;
}) {
  const t = job.ticket;
  const rows: InfoRow[] = [
    { label: "กิจกรรม", value: t.eventName },
    ...(t.ticketTypeName ? [{ label: "ประเภทตั๋ว", value: t.ticketTypeName }] : []),
    { label: "วันเวลา", value: formatEventTime(t.startAt, t.endAt) },
  ];
  if (t.venue) rows.push({ label: "สถานที่", value: t.venue });

  return (
    <EmailLayout ctx={ctx} preview={`คุณได้รับตั๋ว ${t.eventName} แล้ว`} title="รับตั๋วเรียบร้อย">
      <Text style={text}>
        {greeting(job.to.name)} คุณได้รับตั๋วเข้าร่วมกิจกรรมนี้แล้ว
        {qrSrc ? " แสดง QR code ด้านล่างที่จุดเช็กอินในวันงาน" : " เปิดหน้าตั๋วแล้วแสดง QR code ที่จุดเช็กอินในวันงาน"}
      </Text>
      {qrSrc && (
        <Section style={qrBox}>
          <Img src={qrSrc} width={220} height={220} alt="QR code ตั๋วเข้างาน" style={qrImage} />
          <Text style={qrCaption}>QR code ตั๋วเข้างาน</Text>
        </Section>
      )}
      <InfoTable rows={rows} />
      <PrimaryButton href={`${ctx.webOrigin}/tickets/${encodeURIComponent(t.ref)}`}>
        เปิดตั๋วของฉัน
      </PrimaryButton>
      <Text style={mutedText}>
        {qrSrc
          ? "QR code นี้ใช้เข้างานแทนตั๋ว อย่าส่งต่อหรือโพสต์ให้คนอื่นเห็น ถ้าเปิดรูปในอีเมลไม่ได้ ให้เปิดตั๋วในเว็บแทน"
          : "ตั๋วผูกกับบัญชีของคุณ ต้องเข้าสู่ระบบก่อนจึงจะเห็น QR code"}
      </Text>
    </EmailLayout>
  );
}

const qrBox = {
  textAlign: "center" as const,
  margin: "8px 0 20px",
  padding: "16px",
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radius,
  backgroundColor: "#ffffff",
};

// White behind the code itself, so a dark-mode client cannot tint it.
const qrImage = {
  display: "block",
  margin: "0 auto",
  backgroundColor: "#ffffff",
  imageRendering: "pixelated" as const,
};

const qrCaption = {
  ...mutedText,
  margin: "8px 0 0",
  textAlign: "center" as const,
};
