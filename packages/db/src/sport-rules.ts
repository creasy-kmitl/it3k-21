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

// ---- Registrations -------------------------------------------------------

/** review: waiting for registration staff; approved and rejected are their call. */
export const REGISTRATION_STATUSES = ["review", "approved", "rejected"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  review: "รอตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
};

/** มือ 1 or มือ 2 in badminton singles; one of each per institution. */
export const BADMINTON_RANKS = [1, 2] as const;
export type BadmintonRank = (typeof BADMINTON_RANKS)[number];

export const REGISTRATION_CHANGE_ACTIONS = [
  "register",
  "update",
  "withdraw",
  "review",
  "edit",
] as const;
export type RegistrationChangeAction = (typeof REGISTRATION_CHANGE_ACTIONS)[number];

export const STUDENT_ID_PATTERN = /^[0-9A-Za-z-]{4,20}$/;
export const studentIdInput = z
  .string()
  .trim()
  .regex(STUDENT_ID_PATTERN, "กรอกรหัสนักศึกษา 4-20 ตัว (ตัวเลข ตัวอักษร หรือ -)");

const FACEBOOK_URL = /^https:\/\/(?:[a-z0-9-]+\.)*(?:facebook\.com|fb\.com)\//i;

/** What an athlete fills in per registration; which parts apply depends on the division. */
export const registrationFields = z.strictObject({
  shirtNumber: z.number().int().min(0, "เบอร์เสื้อ 0-99").max(99, "เบอร์เสื้อ 0-99").nullable(),
  badmintonRank: z.union([z.literal(1), z.literal(2)]).nullable(),
  ign: z.string().trim().max(64, "ชื่อในเกมยาวได้ไม่เกิน 64 ตัวอักษร"),
  ignReading: z.string().trim().max(100, "คำอ่านยาวได้ไม่เกิน 100 ตัวอักษร"),
  facebookUrl: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === "" || FACEBOOK_URL.test(value), "ใช้ลิงก์ Facebook ที่ขึ้นต้นด้วย https://"),
});
export type RegistrationFields = z.infer<typeof registrationFields>;

export const EMPTY_REGISTRATION_FIELDS: RegistrationFields = {
  shirtNumber: null,
  badmintonRank: null,
  ign: "",
  ignReading: "",
  facebookUrl: "",
};

type DivisionRequirements = {
  requiresShirtNumber: boolean;
  requiresBadmintonRank: boolean;
  requiresGameProfile: boolean;
};

/**
 * The division's required fields that are missing, as `{ field: message }`.
 * The game profile's Discord link is checked separately: it is an account,
 * not a field.
 */
export function missingFields(division: DivisionRequirements, fields: RegistrationFields) {
  const missing: Partial<Record<keyof RegistrationFields, string>> = {};
  if (division.requiresShirtNumber && fields.shirtNumber === null) {
    missing.shirtNumber = "กรอกเบอร์เสื้อ";
  }
  if (division.requiresBadmintonRank && fields.badmintonRank === null) {
    missing.badmintonRank = "เลือกมือ 1 หรือ มือ 2";
  }
  if (division.requiresGameProfile) {
    if (!fields.ign) missing.ign = "กรอกชื่อในเกม (IGN)";
    if (!fields.ignReading) missing.ignReading = "กรอกคำอ่านชื่อในเกม";
    if (!fields.facebookUrl) missing.facebookUrl = "กรอกลิงก์ Facebook";
  }
  return missing;
}

/** Fields that do not apply to the division are stored empty. */
export function applicableFields(
  division: DivisionRequirements,
  fields: RegistrationFields,
): RegistrationFields {
  return {
    shirtNumber: division.requiresShirtNumber ? fields.shirtNumber : null,
    badmintonRank: division.requiresBadmintonRank ? fields.badmintonRank : null,
    ign: division.requiresGameProfile ? fields.ign : "",
    ignReading: division.requiresGameProfile ? fields.ignReading : "",
    facebookUrl: division.requiresGameProfile ? fields.facebookUrl : "",
  };
}

export const reviewInput = z
  .strictObject({
    status: z.enum(REGISTRATION_STATUSES),
    note: z.string().trim().max(500, "เหตุผลยาวได้ไม่เกิน 500 ตัวอักษร"),
  })
  .refine((input) => input.status !== "rejected" || input.note.length > 0, {
    message: "ระบุเหตุผลที่ไม่อนุมัติ",
    path: ["note"],
  });
export type ReviewInput = z.infer<typeof reviewInput>;
