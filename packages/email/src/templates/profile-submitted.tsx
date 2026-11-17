/** @jsxImportSource react */
import { INSTITUTIONS } from "@it3k/db/profile";
import { Text } from "@react-email/components";
import {
  EmailLayout,
  type EmailContext,
  greeting,
  InfoTable,
  mutedText,
  PrimaryButton,
  text,
} from "../components/layout";
import type { ProfileSubmittedJob } from "../jobs";

export const profileSubmittedSubject = () => "ได้รับข้อมูลลงทะเบียนของคุณแล้ว";

const orDash = (value: string) => value.trim() || "-";

export function ProfileSubmittedEmail({
  job,
  ctx,
}: {
  job: ProfileSubmittedJob;
  ctx: EmailContext;
}) {
  const p = job.profile;
  const institution = INSTITUTIONS.find((item) => item.id === p.institution);
  return (
    <EmailLayout ctx={ctx} preview="เราได้รับข้อมูลลงทะเบียนของคุณเรียบร้อยแล้ว" title="ลงทะเบียนสำเร็จ">
      <Text style={text}>
        {greeting(p.nickname || p.firstName)} เราได้รับข้อมูลลงทะเบียนของคุณเรียบร้อยแล้ว
        ตรวจสอบรายละเอียดด้านล่างได้เลย
      </Text>
      <InfoTable
        rows={[
          { label: "ชื่อ-นามสกุล", value: `${p.prefix}${p.firstName} ${p.lastName}`.trim() },
          { label: "ชื่อเล่น", value: orDash(p.nickname) },
          { label: "เบอร์โทรศัพท์", value: orDash(p.phone) },
          { label: "สถาบัน", value: institution?.name ?? "-" },
          { label: "โรคประจำตัว", value: orDash(p.medicalConditions) },
          { label: "แพ้ยา", value: orDash(p.drugAllergies) },
          { label: "แพ้อาหาร", value: orDash(p.foodAllergies) },
          { label: "ข้อจำกัดด้านอาหาร", value: orDash(p.dietaryRestrictions) },
        ]}
      />
      <PrimaryButton href={`${ctx.webOrigin}/me`}>ดูโปรไฟล์ของฉัน</PrimaryButton>
      <Text style={mutedText}>
        ถ้าข้อมูลไม่ถูกต้อง แก้ไขได้ที่หน้าโปรไฟล์ หากคุณไม่ได้ลงทะเบียน ไม่ต้องทำอะไรกับอีเมลนี้
      </Text>
    </EmailLayout>
  );
}
