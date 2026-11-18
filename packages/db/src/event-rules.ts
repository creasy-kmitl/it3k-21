// Venue and event rules shared by the API and the web app. Kept free of
// Drizzle so the browser bundle can import it.
import { z } from "zod";

import { imageUrlSchema } from "./image-url";
import { INSTITUTION_IDS } from "./profile";
import { richTextDocSchema } from "./rich-text";
import { UUID_PATTERN, slugify } from "./slugify";

export const EVENT_TYPES = ["sport", "general"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  sport: "กิจกรรมกีฬา",
  general: "กิจกรรมทั่วไป",
};

export const CHECKIN_METHODS = ["scan", "manual"] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

/** What a ticket's QR holds before its code, so the kiosk tells it from a profile barcode. */
export const TICKET_QR_PREFIX = "it3k-t:";
/** A ticket code: 24 random bytes as base64url. */
export const TICKET_CODE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
export const ticketCode = z.string().regex(TICKET_CODE_PATTERN);
export const MAX_TICKET_CAPACITY = 100_000;
export const MAX_TICKET_TYPES = 20;
export const MAX_TICKETS_PER_USER = 20;

/**
 * The account roles a ticket type may be limited to. The same list as
 * `ROLES` in `@it3k/auth/permissions`, which this package cannot import; a
 * server test keeps the two in step.
 */
export const TICKET_ROLES = ["guest", "participant", "athlete", "staff", "admin"] as const;
export type TicketRole = (typeof TICKET_ROLES)[number];

/** How long the plain-text summary made from an event's content may be. */
export const EVENT_SUMMARY_MAX = 300;

/** A new random ticket code. */
export function newTicketCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
}

/** What a scanned code means: a ticket's QR or a profile barcode (an account id). */
export function parseScan(raw: string): { ticketCode: string } | { userId: string } {
  const text = raw.trim();
  if (text.toLowerCase().startsWith(TICKET_QR_PREFIX)) {
    return { ticketCode: text.slice(TICKET_QR_PREFIX.length) };
  }
  return { userId: text };
}

/** An event may last at most this long, like a calendar item. */
export const MAX_EVENT_MS = 31 * 24 * 60 * 60 * 1000;
export const MAX_EVENT_DIVISIONS = 100;

export const EVENT_SLUG_MIN = 3;
export const EVENT_SLUG_MAX = 64;
/** Lowercase letters and digits, words joined by single hyphens. */
export const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Room left after a generated slug for a "-2" … "-999" suffix. */
const EVENT_SLUG_BASE_MAX = EVENT_SLUG_MAX - 4;

/**
 * An event's slug, or "" to have one made from its name. A slug shaped like
 * an event id is refused, so `/kiosk/<id or slug>` always means one event.
 */
export const eventSlug = z
  .string()
  .trim()
  .max(EVENT_SLUG_MAX, `ยาวได้ไม่เกิน ${EVENT_SLUG_MAX} ตัวอักษร`)
  .refine(
    (value) => value === "" || value.length >= EVENT_SLUG_MIN,
    `ยาวอย่างน้อย ${EVENT_SLUG_MIN} ตัวอักษร`,
  )
  .refine(
    (value) => value === "" || EVENT_SLUG_PATTERN.test(value),
    "ใช้ได้เฉพาะ a-z, 0-9 และขีดกลาง (-) คั่นระหว่างคำ",
  )
  .refine((value) => !UUID_PATTERN.test(value), "ตั้งให้เหมือนรหัสกิจกรรมไม่ได้");

/** `YYYY-MM-DD` in Bangkok, which has no daylight saving. */
const bangkokDay = (ms: number) => new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * The slug an event gets when none is typed: its name slugified, or, when
 * the name leaves too little (a Thai name keeps only its Latin letters and
 * digits), its type and Bangkok start date, e.g. "sport-2026-11-15".
 */
export function eventSlugBase(event: { name: string; type: EventType; startAt: number }): string {
  const fromName = slugify(event.name).slice(0, EVENT_SLUG_BASE_MAX).replace(/-+$/, "");
  if (fromName.length >= EVENT_SLUG_MIN && !UUID_PATTERN.test(fromName)) return fromName;
  return `${event.type}-${bangkokDay(event.startAt)}`;
}

/** `base`, or `base-2`, `base-3` … whichever is not taken yet. */
export function firstFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

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

const ticketCount = (min: number, max: number, unit = "ใบ") =>
  z
    .number({ error: "กรอกเป็นตัวเลข" })
    .int("กรอกเป็นจำนวนเต็ม")
    .min(min, `อย่างน้อย ${min} ${unit}`)
    .max(max, `ไม่เกิน ${max.toLocaleString("en-US")} ${unit}`);

/** One ticket type as the event editor sends it; a new one has no id. */
export const ticketTypeInput = z.strictObject({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1, "กรอกชื่อประเภทตั๋ว").max(60, "ชื่อยาวได้ไม่เกิน 60 ตัวอักษร"),
  description: z.string().trim().max(300, "คำอธิบายยาวได้ไม่เกิน 300 ตัวอักษร"),
  capacity: ticketCount(1, MAX_TICKET_CAPACITY).nullable(),
  maxPerUser: ticketCount(1, MAX_TICKETS_PER_USER),
  open: z.boolean(),
  // Sport events only.
  listedOnly: z.boolean(),
  allowedRoles: z.array(z.enum(TICKET_ROLES)).max(TICKET_ROLES.length),
  allowedInstitutions: z.array(z.enum(INSTITUTION_IDS)).max(INSTITUTION_IDS.length),
  allowedSportIds: z.array(z.string().min(1).max(64)).max(100),
});
export type TicketTypeInput = z.infer<typeof ticketTypeInput>;

/** A new ticket type: anyone may claim one, once, with no seat limit. */
export function defaultTicketType(name = "ทั่วไป"): TicketTypeInput {
  return {
    name,
    description: "",
    capacity: null,
    maxPerUser: 1,
    open: true,
    listedOnly: false,
    allowedRoles: [],
    allowedInstitutions: [],
    allowedSportIds: [],
  };
}

/** What creating an event takes; everything else is set on its edit tab. */
export const eventDraftInput = z.strictObject({
  name,
  // "" makes one from the name.
  slug: eventSlug,
});
export type EventDraftInput = z.infer<typeof eventDraftInput>;

const eventFields = z.strictObject({
  type: z.enum(EVENT_TYPES),
  name,
  // "" makes one from the name. Omitted, a new event gets one from its name
  // and an existing one keeps its own.
  slug: eventSlug.optional(),
  // The event page's body; null for none.
  content: richTextDocSchema.nullable(),
  startAt: epochMs,
  endAt: epochMs,
  venueId: z.string().min(1).max(64).nullable(),
  thumbnailUrl: imageUrlSchema,
  ticketsOpen: z.boolean(),
  // A cap across all ticket types; null for none.
  ticketCapacity: ticketCount(1, MAX_TICKET_CAPACITY).nullable(),
  // In the order participants see them.
  ticketTypes: z.array(ticketTypeInput).max(MAX_TICKET_TYPES, `มีได้ไม่เกิน ${MAX_TICKET_TYPES} ประเภท`),
  // Sport events only; a general event sends both empty.
  institutions: z.array(z.enum(INSTITUTION_IDS)).max(INSTITUTION_IDS.length),
  divisionIds: z.array(z.string().min(1).max(64)).max(MAX_EVENT_DIVISIONS),
});

type EventFields = z.infer<typeof eventFields>;

type Problem = { path: (string | number)[]; message: string };

/** What is wrong with an event's times, links and ticket types, field by field. */
export function eventProblems(event: EventFields): Problem[] {
  const problems: Problem[] = [];
  const push = (path: keyof EventFields, message: string) => problems.push({ path: [path], message });
  if (event.endAt <= event.startAt) {
    push("endAt", "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม");
  } else if (event.endAt - event.startAt > MAX_EVENT_MS) {
    push("endAt", "กิจกรรมยาวได้ไม่เกิน 31 วัน");
  }
  if (event.type === "sport") {
    if (event.institutions.length === 0) {
      push("institutions", "เลือกอย่างน้อย 1 สถาบัน");
    }
    if (event.divisionIds.length === 0) {
      push("divisionIds", "เลือกอย่างน้อย 1 ประเภทกีฬา");
    }
  } else if (event.institutions.length > 0 || event.divisionIds.length > 0) {
    push("type", "กิจกรรมทั่วไปไม่มีสถาบันหรือประเภทกีฬา");
  }
  if (new Set(event.institutions).size !== event.institutions.length) {
    push("institutions", "เลือกสถาบันซ้ำ");
  }
  if (new Set(event.divisionIds).size !== event.divisionIds.length) {
    push("divisionIds", "เลือกประเภทกีฬาซ้ำ");
  }
  const names = new Set<string>();
  const ids = new Set<string>();
  event.ticketTypes.forEach((type, index) => {
    const at = (field: keyof TicketTypeInput, message: string) =>
      problems.push({ path: ["ticketTypes", index, field], message });
    const key = type.name.trim().toLowerCase();
    if (names.has(key)) at("name", "ชื่อประเภทตั๋วซ้ำกัน");
    names.add(key);
    if (type.id) {
      if (ids.has(type.id)) at("id", "ประเภทตั๋วซ้ำกัน");
      ids.add(type.id);
    }
    if (type.listedOnly && event.type !== "sport") {
      at("listedOnly", "ใช้ได้เฉพาะกิจกรรมกีฬา");
    }
    if (type.capacity !== null && type.maxPerUser > type.capacity) {
      at("maxPerUser", "มากกว่าจำนวนตั๋วของประเภทนี้");
    }
    for (const [field, list] of [
      ["allowedRoles", type.allowedRoles],
      ["allowedInstitutions", type.allowedInstitutions],
      ["allowedSportIds", type.allowedSportIds],
    ] as const) {
      if (new Set<string>(list).size !== list.length) at(field, "เลือกซ้ำ");
    }
  });
  if (event.ticketsOpen && !event.ticketTypes.some((type) => type.open)) {
    push("ticketTypes", "เปิดรับตั๋วต้องมีอย่างน้อย 1 ประเภทที่เปิดรับ");
  }
  return problems;
}

export const eventInput = eventFields.superRefine((event, ctx) => {
  for (const { path, message } of eventProblems(event)) {
    ctx.addIssue({ code: "custom", path, message });
  }
});
export type EventInput = z.infer<typeof eventInput>;
