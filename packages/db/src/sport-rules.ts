// Sport rules shared by the API and the web app. Kept free of Drizzle so the
// browser bundle can import it.
import { z } from "zod";

/** Keys the web app maps to an illustration (components/sport-art.tsx). */
export const SPORT_ICONS = [
  "football",
  "athletics",
  "basketball",
  "table-tennis",
  "chairball",
  "badminton",
  "petanque",
  "folk",
  "esports",
  "general",
] as const;
export type SportIcon = (typeof SPORT_ICONS)[number];

export const DIVISION_GENDERS = ["male", "female", "mixed", "open"] as const;
export type DivisionGender = (typeof DIVISION_GENDERS)[number];

export const DIVISION_FORMATS = ["individual", "pair", "team"] as const;
export type DivisionFormat = (typeof DIVISION_FORMATS)[number];

export const GENDER_LABELS: Record<DivisionGender, string> = {
  male: "ชาย",
  female: "หญิง",
  mixed: "ผสม",
  open: "ไม่จำกัดเพศ",
};

export const FORMAT_LABELS: Record<DivisionFormat, string> = {
  individual: "เดี่ยว",
  pair: "คู่",
  team: "ทีม",
};

/** Lowercase words joined by single hyphens, like department codes. */
export const SPORT_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const code = z
  .string()
  .trim()
  .min(1, "กรอกรหัส")
  .max(48, "รหัสยาวได้ไม่เกิน 48 ตัวอักษร")
  .regex(SPORT_CODE_PATTERN, "ใช้ a-z, 0-9 และ - เท่านั้น");
const name = z.string().trim().min(1, "กรอกชื่อ").max(100, "ชื่อยาวได้ไม่เกิน 100 ตัวอักษร");
const description = z.string().trim().max(2000, "คำอธิบายยาวได้ไม่เกิน 2,000 ตัวอักษร");
const thumbnailUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || value.startsWith("https://"), "ใช้ลิงก์ที่ขึ้นต้นด้วย https://");
const sortOrder = z.number().int().min(0).max(10_000);

export const sportInput = z.strictObject({
  code,
  name,
  description,
  icon: z.enum(SPORT_ICONS),
  thumbnailUrl,
  sortOrder,
});
export type SportInput = z.infer<typeof sportInput>;

export const divisionInput = z.strictObject({
  code,
  name,
  gender: z.enum(DIVISION_GENDERS),
  format: z.enum(DIVISION_FORMATS),
  requiresShirtNumber: z.boolean(),
  requiresBadmintonRank: z.boolean(),
  requiresGameProfile: z.boolean(),
  maxPerInstitution: z.number().int().min(1).max(1000).nullable(),
  registrationOpen: z.boolean(),
  sortOrder,
});
export type DivisionInput = z.infer<typeof divisionInput>;
