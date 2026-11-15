// Venue and event rules shared by the API and the web app. Kept free of
// Drizzle so the browser bundle can import it.
import { z } from "zod";

import { INSTITUTION_IDS } from "./profile";

export const EVENT_TYPES = ["sport", "general"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  sport: "กิจกรรมกีฬา",
  general: "กิจกรรมทั่วไป",
};

/** An event may last at most this long, like a calendar item. */
export const MAX_EVENT_MS = 31 * 24 * 60 * 60 * 1000;
export const MAX_EVENT_DIVISIONS = 100;

const name = z.string().trim().min(1, "กรอกชื่อ").max(120, "ชื่อยาวได้ไม่เกิน 120 ตัวอักษร");
const description = z.string().trim().max(2000, "คำอธิบายยาวได้ไม่เกิน 2,000 ตัวอักษร");
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || value.startsWith("https://"), "ใช้ลิงก์ที่ขึ้นต้นด้วย https://");
const epochMs = z
  .number()
  .int()
  .min(Date.UTC(2020, 0, 1))
  .max(Date.UTC(2100, 0, 1));

export const venueInput = z
  .strictObject({
    name,
    description,
    latitude: z
      .number({ error: "กรอกเป็นตัวเลข" })
      .min(-90, "ละติจูดอยู่ระหว่าง -90 ถึง 90")
      .max(90, "ละติจูดอยู่ระหว่าง -90 ถึง 90")
      .nullable(),
    longitude: z
      .number({ error: "กรอกเป็นตัวเลข" })
      .min(-180, "ลองจิจูดอยู่ระหว่าง -180 ถึง 180")
      .max(180, "ลองจิจูดอยู่ระหว่าง -180 ถึง 180")
      .nullable(),
    externalUrl: httpsUrl,
  })
  .refine((venue) => (venue.latitude === null) === (venue.longitude === null), {
    message: "กรอกทั้งละติจูดและลองจิจูด หรือเว้นว่างทั้งคู่",
    path: ["longitude"],
  });
export type VenueInput = z.infer<typeof venueInput>;

const eventFields = z.strictObject({
  type: z.enum(EVENT_TYPES),
  name,
  description,
  startAt: epochMs,
  endAt: epochMs,
  venueId: z.string().min(1).max(64).nullable(),
  thumbnailUrl: httpsUrl,
  // Sport events only; a general event sends both empty.
  institutions: z.array(z.enum(INSTITUTION_IDS)).max(INSTITUTION_IDS.length),
  divisionIds: z.array(z.string().min(1).max(64)).max(MAX_EVENT_DIVISIONS),
});

type EventFields = z.infer<typeof eventFields>;

/** What is wrong with an event's times and links, field by field. */
export function eventProblems(event: EventFields): { path: keyof EventFields; message: string }[] {
  const problems: { path: keyof EventFields; message: string }[] = [];
  if (event.endAt <= event.startAt) {
    problems.push({ path: "endAt", message: "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม" });
  } else if (event.endAt - event.startAt > MAX_EVENT_MS) {
    problems.push({ path: "endAt", message: "กิจกรรมยาวได้ไม่เกิน 31 วัน" });
  }
  if (event.type === "sport") {
    if (event.institutions.length === 0) {
      problems.push({ path: "institutions", message: "เลือกอย่างน้อย 1 สถาบัน" });
    }
    if (event.divisionIds.length === 0) {
      problems.push({ path: "divisionIds", message: "เลือกอย่างน้อย 1 ประเภทกีฬา" });
    }
  } else if (event.institutions.length > 0 || event.divisionIds.length > 0) {
    problems.push({ path: "type", message: "กิจกรรมทั่วไปไม่มีสถาบันหรือประเภทกีฬา" });
  }
  if (new Set(event.institutions).size !== event.institutions.length) {
    problems.push({ path: "institutions", message: "เลือกสถาบันซ้ำ" });
  }
  if (new Set(event.divisionIds).size !== event.divisionIds.length) {
    problems.push({ path: "divisionIds", message: "เลือกประเภทกีฬาซ้ำ" });
  }
  return problems;
}

export const eventInput = eventFields.superRefine((event, ctx) => {
  for (const { path, message } of eventProblems(event)) {
    ctx.addIssue({ code: "custom", path: [path], message });
  }
});
export type EventInput = z.infer<typeof eventInput>;
