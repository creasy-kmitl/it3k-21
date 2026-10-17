import { z } from "zod";

export const GiB = 1024 ** 3;
export const MiB = 1024 ** 2;
export const MAX_FILE_SIZE = 50 * MiB;
export const MAX_PHOTO_SIZE = 10 * MiB;
export const MAX_FILES_PER_USER = 1000;
export const MAX_PENDING_UPLOADS = 10;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PREFIXES = ["นาย", "นาง", "นางสาว"] as const;
export const INSTITUTIONS = [
  {
    id: "kmitl",
    name: "สถาบันเทคโนโลยีพระจอมเกล้าเจ้าคุณทหารลาดกระบัง",
    short: "สจล.",
    logo: "/institutions/kmitl.svg",
  },
  {
    id: "kmutt",
    name: "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี",
    short: "มจธ.",
    logo: "/institutions/kmutt.png",
  },
  {
    id: "kmutnb-bangkok",
    name: "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ วิทยาเขตกรุงเทพฯ",
    short: "มจพ. กรุงเทพฯ",
    logo: "/institutions/kmutnb.png",
  },
  {
    id: "kmutnb-prachinburi",
    name: "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ วิทยาเขตปราจีนบุรี",
    short: "มจพ. ปราจีนบุรี",
    logo: "/institutions/kmutnb.png",
  },
] as const;

export function suggestedInstitution(email: string) {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  if (domain === "kmitl.ac.th" || domain.endsWith(".kmitl.ac.th")) return "kmitl";
  if (domain === "kmutt.ac.th" || domain.endsWith(".kmutt.ac.th")) return "kmutt";
  return "";
}

const text = z.string().max(100, "กรอกได้ไม่เกิน 100 ตัวอักษร");
const medical = z.string().max(2000, "กรอกได้ไม่เกิน 2,000 ตัวอักษร");
const phone = z.string().max(32, "กรอกเบอร์โทรไม่เกิน 32 ตัวอักษร");
export const draftSchema = z.strictObject({
  prefix: z.enum(["", ...PREFIXES]),
  firstName: text,
  lastName: text,
  nickname: text,
  phone,
  photoFileId: z.string().max(100),
  medicalConditions: medical,
  drugAllergies: medical,
  foodAllergies: medical,
  dietaryRestrictions: medical,
  institution: z.enum(["", "kmitl", "kmutt", "kmutnb-bangkok", "kmutnb-prachinburi"]),
});
export type ProfileValues = z.infer<typeof draftSchema>;
export const EMPTY_PROFILE: ProfileValues = {
  prefix: "",
  firstName: "",
  lastName: "",
  nickname: "",
  phone: "",
  photoFileId: "",
  medicalConditions: "",
  drugAllergies: "",
  foodAllergies: "",
  dietaryRestrictions: "",
  institution: "",
};
export const profileSchema = draftSchema.extend({
  prefix: z.enum(PREFIXES, { error: "เลือกคำนำหน้า" }),
  firstName: text.trim().min(1, "กรอกชื่อ"),
  lastName: text.trim().min(1, "กรอกนามสกุล"),
  nickname: text.trim().min(1, "กรอกชื่อเล่น"),
  phone: phone
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .refine((value) => /^(0\d{9}|\+66\d{9})$/.test(value), "กรอกเบอร์โทร 10 หลัก หรือรูปแบบ +66"),
  photoFileId: z.string().min(1, "เลือกรูปภาพ"),
  institution: z.enum(["kmitl", "kmutt", "kmutnb-bangkok", "kmutnb-prachinburi"], {
    error: "เลือกมหาวิทยาลัย/สถาบัน",
  }),
});
export const draftInput = z.strictObject({
  userId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  values: draftSchema,
});
export const submitInput = z.strictObject({
  userId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  values: profileSchema,
});
