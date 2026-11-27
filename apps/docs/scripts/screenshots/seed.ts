/**
 * Fills a *demo* local D1 with the made-up accounts and data the guide's
 * screenshots show. Run it while `bun run dev` is up (it uploads profile
 * photos through the API):
 *
 *   bun apps/docs/scripts/screenshots/seed.ts
 *
 * It refuses to touch a database holding any account that isn't `demo-…`, so
 * it never mixes into a dev database with real people in it. Re-running it
 * replaces the demo rows. See apps/docs/content/docs/developers/docs-screenshots.mdx.
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { findLocalD1 } from "@it3k/db/local-d1";
import type { ProfileValues } from "@it3k/db/profile";
import * as s from "@it3k/db/schema/index";
import { inArray, like, notLike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";

import {
  ALL_ACCOUNTS,
  CROWD,
  OTHER_SEATS,
  PERSONAS,
  SESSIONS_FILE,
  emailOf,
  type Persona,
} from "./personas";
import { API_URL, SESSION_COOKIE, randomToken, readAuthSecret, signedSessionCookie } from "./session";

const force = process.argv.includes("--force");
const file = findLocalD1();
const sqlite = new Database(file);
sqlite.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
const db = drizzle({ client: sqlite });

// ── Safety: demo databases only ────────────────────────────────────────────
const others = db
  .select({ id: s.user.id })
  .from(s.user)
  .where(notLike(s.user.id, "demo-%"))
  .all();
if (others.length > 0 && !force) {
  console.error(
    `Refusing to seed ${file}: it holds ${others.length} non-demo account(s).\n` +
      "Screenshots must not show real people. Start dev on an empty local D1 first " +
      "(see the developers' screenshot guide), or pass --force if you really mean it.",
  );
  process.exit(1);
}

// ── Time helpers: everything is relative to today, in Bangkok time ─────────
const DAY = 86_400_000;
const bangkokMidnight = (() => {
  const now = new Date(Date.now() + 7 * 3_600_000);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 7 * 3_600_000;
})();
/** `days` from today at `hh:mm` Bangkok time. */
const at = (days: number, time = "09:00") => {
  const [h, m] = time.split(":").map(Number);
  return new Date(bangkokMidnight + days * DAY + ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
};
const bangkokDay = (days: number) => new Date(bangkokMidnight + days * DAY + 7 * 3_600_000).toISOString().slice(0, 10);

// ── Lookups ────────────────────────────────────────────────────────────────
const departments = db.select().from(s.department).all();
const dept = (code: string) => {
  const row = departments.find((d) => d.code === code);
  if (!row) throw new Error(`No department with code ${code}`);
  return row.id;
};
const divisions = db.select().from(s.sportDivision).all();
const division = (code: string) => {
  const row = divisions.find((d) => d.code === code);
  if (!row) throw new Error(`No sport division ${code}; are the seed migrations applied?`);
  return row;
};

// ── 1. Remove the previous demo rows ───────────────────────────────────────
const demoUsers = db.select({ id: s.user.id }).from(s.user).where(like(s.user.id, "demo-%")).all();
const demoIds = demoUsers.map((u) => u.id);
db.transaction((tx) => {
  // Matches first: their sides cascade, and sides hold the teams.
  tx.delete(s.competitionMatch).where(like(s.competitionMatch.id, "demo-%")).run();
  tx.delete(s.competitionTeam).where(like(s.competitionTeam.id, "demo-%")).run();
  tx.delete(s.emailCampaign).where(like(s.emailCampaign.id, "demo-%")).run();
  tx.delete(s.event).where(like(s.event.id, "demo-%")).run(); // cascades types, tickets, check-ins
  tx.delete(s.venue).where(like(s.venue.id, "demo-%")).run();
  tx.delete(s.calendarItem).where(like(s.calendarItem.id, "demo-%")).run();
  tx.delete(s.shortLink).where(like(s.shortLink.id, "demo-%")).run();
  tx.delete(s.invitation).where(like(s.invitation.id, "demo-%")).run();
  tx.delete(s.leadership).where(like(s.leadership.id, "demo-%")).run();
  if (demoIds.length) {
    tx.delete(s.sportRegistration).where(inArray(s.sportRegistration.userId, demoIds)).run();
    tx.delete(s.uploadedFile).where(inArray(s.uploadedFile.ownerId, demoIds)).run();
  }
  tx.delete(s.user).where(like(s.user.id, "demo-%")).run(); // cascades sessions, profiles, athletes
});

// ── 2. Accounts, seats and sessions ────────────────────────────────────────
const sessions: Record<string, string> = {};
const secret = readAuthSecret();
db.transaction((tx) => {
  for (const p of ALL_ACCOUNTS) {
    tx.insert(s.user)
      .values({
        id: p.id,
        name: p.name,
        email: emailOf(p),
        emailVerified: true,
        role: p.role,
        departmentId: p.department ? dept(p.department) : null,
        institution: p.institution ?? null,
      })
      .run();
    const token = randomToken();
    sessions[p.id] = token;
    tx.insert(s.session)
      .values({
        id: `demo-session-${p.id}`,
        token,
        userId: p.id,
        expiresAt: new Date(Date.now() + 30 * DAY),
        updatedAt: new Date(),
        userAgent: "it3k-docs-screenshots",
      })
      .run();
  }
  for (const p of Object.values(PERSONAS) as Persona[]) {
    if (!p.seat || !p.department) continue;
    tx.insert(s.leadership)
      .values({
        id: `demo-seat-${p.department}-${p.seat}`,
        departmentId: dept(p.department),
        role: p.seat,
        userId: p.id,
        name: p.name,
        nickname: p.nickname,
        phone: "0800000100",
      })
      .run();
  }
  for (const seat of OTHER_SEATS) {
    tx.insert(s.leadership)
      .values({
        id: `demo-seat-${seat.department}-${seat.role}`,
        departmentId: dept(seat.department),
        role: seat.role,
        name: seat.name,
        nickname: seat.nickname,
        phone: seat.phone,
      })
      .run();
  }
});

// ── 3. Profile photos, through the API so they land in local R2 ────────────
async function cookieFor(id: string) {
  const token = sessions[id];
  if (!token) throw new Error(`No session for ${id}`);
  return `${SESSION_COOKIE}=${await signedSessionCookie(token, secret)}`;
}

async function uploadAvatar(p: Persona): Promise<string> {
  const bytes = readFileSync(resolve(import.meta.dirname, `avatars/avatar-${p.avatar}.png`));
  const headers = { cookie: await cookieFor(p.id), origin: "http://localhost:3001" };
  const created = await fetch(`${API_URL}/api/files/uploads`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ userId: p.id, name: `${p.nickname}.png`, contentType: "image/png", size: bytes.byteLength }),
  });
  if (!created.ok) throw new Error(`Upload for ${p.id} failed: ${created.status} ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  const put = await fetch(`${API_URL}/api/files/${id}/content?userId=${p.id}`, {
    method: "PUT",
    headers: { ...headers, "content-type": "image/png", "content-length": String(bytes.byteLength) },
    body: bytes,
  });
  if (!put.ok) throw new Error(`Upload body for ${p.id} failed: ${put.status} ${await put.text()}`);
  return id;
}

const PHONES = ["0812345678", "0898765432", "0861112233", "0953334444", "0624445555", "0805556666"];
const profiles: { userId: string; values: ProfileValues }[] = [];
for (const [i, p] of ALL_ACCOUNTS.entries()) {
  if (!p.avatar || !p.institution) continue;
  const photoFileId = await uploadAvatar(p);
  const [firstName = "", lastName = ""] = p.name.split(" ");
  profiles.push({
    userId: p.id,
    values: {
      prefix: p.prefix,
      firstName,
      lastName,
      nickname: p.nickname,
      phone: PHONES[i % PHONES.length] ?? "0812345678",
      photoFileId,
      medicalConditions: i % 4 === 0 ? "หอบหืด (พกยาพ่นติดตัว)" : "",
      drugAllergies: i % 5 === 0 ? "เพนิซิลลิน" : "",
      foodAllergies: i % 3 === 0 ? "กุ้ง" : "",
      dietaryRestrictions: i % 6 === 0 ? "มังสวิรัติ" : "",
      institution: p.institution,
    },
  });
}

// ── 4. Everything else, in one transaction ─────────────────────────────────
const { techHead, techStaff, artStaff, artHead, regHead, participant, athlete } = PERSONAS;
const doc = (...paragraphs: string[]) => ({
  type: "doc" as const,
  content: paragraphs.map((text) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] })),
});

db.transaction((tx) => {
  for (const profile of profiles) {
    tx.insert(s.userProfile)
      .values({
        userId: profile.userId,
        draft: profile.values,
        values: profile.values,
        revision: 1,
        dirty: false,
        submittedAt: at(-12, "20:15"),
      })
      .run();
  }

  // Athletes and their registrations.
  const studentIds: Record<string, string> = {};
  const registrations: (typeof s.sportRegistration.$inferInsert)[] = [];
  const register = (
    p: Persona,
    code: string,
    status: "review" | "approved" | "rejected",
    extra: Partial<typeof s.sportRegistration.$inferInsert> = {},
  ) => {
    studentIds[p.id] ??= `6${(70_000_000 + Object.keys(studentIds).length * 1_234_567).toString()}`;
    registrations.push({
      id: `demo-reg-${p.id}-${code}`,
      userId: p.id,
      divisionId: division(code).id,
      institution: p.institution ?? "kmitl",
      status,
      reviewedBy: status === "review" ? null : regHead.id,
      reviewedAt: status === "review" ? null : at(-3, "14:00"),
      reviewNote: status === "rejected" ? "รูปบัตรนักศึกษาไม่ชัด กรุณาแก้ไขและส่งใหม่" : null,
      ...extra,
    });
  };
  const [p01, p02, p03, p04, p05, p06, p07, p08, p09, p10] = CROWD as [Persona, ...Persona[]] & Persona[];
  register(athlete, "football", "approved", { shirtNumber: 10 });
  register(athlete, "badminton-singles-male", "review", { badmintonRank: 1 });
  register(p01, "football", "approved", { shirtNumber: 7 });
  register(p03, "football", "approved", { shirtNumber: 9 });
  register(p09, "football", "review", { shirtNumber: 4 });
  register(p05, "football", "approved", { shirtNumber: 11 });
  register(p02, "badminton-singles-female", "approved", { badmintonRank: 1 });
  register(p04, "badminton-singles-female", "review", { badmintonRank: 1 });
  register(p06, "table-tennis-singles-female", "approved");
  register(p07, "basketball-5x5-male", "rejected", { shirtNumber: 23 });
  register(p08, "petanque-female", "review");
  register(p10, "athletics-100m-female", "approved");
  register(p10, "badminton-singles-female", "approved", { badmintonRank: 2 });
  register(p03, "athletics-100m-male", "review");
  for (const [userId, studentId] of Object.entries(studentIds)) {
    tx.insert(s.athlete).values({ userId, studentId }).run();
  }
  for (const row of registrations) tx.insert(s.sportRegistration).values(row).run();

  // Venues.
  const venues = [
    { id: "demo-venue-hall", name: "หอประชุม สจล.", latitude: 13.727, longitude: 100.778, description: "ที่นั่ง 1,500 ที่ มีห้องพักนักกีฬาด้านหลังเวที" },
    { id: "demo-venue-stadium", name: "สนามกีฬากลาง สจล.", latitude: 13.7302, longitude: 100.7745, description: "สนามฟุตบอลและลู่วิ่ง" },
    { id: "demo-venue-gym", name: "โรงยิมเนเซียม", latitude: 13.7288, longitude: 100.7731, description: "แบดมินตัน เทเบิลเทนนิส และบาสเกตบอล" },
    { id: "demo-venue-it", name: "ลานกิจกรรมคณะเทคโนโลยีสารสนเทศ", latitude: 13.7313, longitude: 100.781, description: "จุดลงทะเบียนและเวที Esports" },
  ];
  for (const v of venues) tx.insert(s.venue).values(v).run();

  // Events, ticket types, tickets and check-ins.
  type EventRow = typeof s.event.$inferInsert;
  const events: EventRow[] = [
    {
      id: "demo-event-opening",
      type: "general",
      name: "พิธีเปิด IT3Kings ครั้งที่ 21",
      slug: "opening-ceremony",
      description: "พิธีเปิดการแข่งขัน ขบวนพาเหรดจาก 3 สถาบัน และการแสดงจากนักศึกษา",
      content: doc(
        "ขอเชิญผู้เข้าร่วมทุกคนร่วมพิธีเปิดการแข่งขันกีฬาสานสัมพันธ์ IT3Kings ครั้งที่ 21",
        "ภายในงานมีขบวนพาเหรดจากทั้ง 3 สถาบัน การแสดงจากนักศึกษา และการจุดคบเพลิง กรุณามาถึงก่อนเวลาเริ่มงาน 30 นาทีเพื่อเช็คอินที่หน้าหอประชุม",
      ),
      startAt: at(16, "08:30"),
      endAt: at(16, "12:00"),
      venueId: "demo-venue-hall",
      ticketsOpen: true,
      ticketCapacity: 800,
      createdBy: techHead.id,
    },
    {
      id: "demo-event-football",
      type: "sport",
      name: "ฟุตบอล รอบแบ่งกลุ่ม สจล. พบ มจธ.",
      slug: "football-group-a",
      description: "ฟุตบอลชาย รอบแบ่งกลุ่ม นัดที่ 1",
      content: doc("ฟุตบอลชาย รอบแบ่งกลุ่ม นัดที่ 1 นักกีฬากรุณารายงานตัวก่อนเวลาแข่ง 45 นาที", "กองเชียร์รับตั๋วได้ที่หน้านี้ จำนวนจำกัด"),
      startAt: at(16, "14:00"),
      endAt: at(16, "16:00"),
      venueId: "demo-venue-stadium",
      ticketsOpen: true,
      createdBy: techHead.id,
    },
    {
      id: "demo-event-rov",
      type: "sport",
      name: "Esports ROV รอบชิงชนะเลิศ",
      slug: "rov-final",
      description: "ชมการแข่งขัน ROV รอบชิงชนะเลิศ ที่เวทีลานกิจกรรมคณะไอที",
      content: doc("ชมการแข่งขัน ROV รอบชิงชนะเลิศสด ที่เวทีลานกิจกรรมคณะไอที มีที่นั่งจำกัด"),
      startAt: at(17, "18:00"),
      endAt: at(17, "21:00"),
      venueId: "demo-venue-it",
      ticketsOpen: true,
      createdBy: techHead.id,
    },
    {
      id: "demo-event-closing",
      type: "general",
      name: "งานเลี้ยงสังสรรค์ปิดการแข่งขัน",
      slug: "closing-party",
      description: "งานเลี้ยงปิดการแข่งขันและประกาศผลรางวัล",
      content: doc("งานเลี้ยงปิดการแข่งขันและประกาศผลรางวัล จะเปิดรับตั๋วหลังพิธีเปิด"),
      startAt: at(18, "17:00"),
      endAt: at(18, "21:00"),
      venueId: "demo-venue-hall",
      ticketsOpen: false,
      createdBy: techHead.id,
    },
  ];
  for (const e of events) tx.insert(s.event).values(e).run();
  tx.insert(s.eventInstitution)
    .values([
      { eventId: "demo-event-football", institution: "kmitl" },
      { eventId: "demo-event-football", institution: "kmutt" },
    ])
    .run();
  tx.insert(s.eventDivision).values({ eventId: "demo-event-football", divisionId: division("football").id }).run();
  tx.insert(s.eventDivision).values({ eventId: "demo-event-rov", divisionId: division("esports-rov").id }).run();

  const types: (typeof s.eventTicketType.$inferInsert)[] = [
    { id: "demo-tt-opening-general", eventId: "demo-event-opening", name: "ผู้เข้าร่วม", description: "สำหรับผู้เข้าร่วมและนักกีฬาทุกสถาบัน", capacity: 700, sortOrder: 0, allowedRoles: ["participant", "athlete"] },
    { id: "demo-tt-opening-staff", eventId: "demo-event-opening", name: "ทีมงาน", description: "เฉพาะสตาฟ", capacity: 100, sortOrder: 1, allowedRoles: ["staff", "admin"] },
    { id: "demo-tt-football-athlete", eventId: "demo-event-football", name: "นักกีฬา", description: "เฉพาะนักกีฬาในรายชื่อการแข่งขันนี้", sortOrder: 0, listedOnly: true },
    { id: "demo-tt-football-fan", eventId: "demo-event-football", name: "กองเชียร์", description: "รับได้คนละ 2 ใบ", capacity: 200, maxPerUser: 2, sortOrder: 1 },
    { id: "demo-tt-rov", eventId: "demo-event-rov", name: "ผู้ชม", capacity: 3, sortOrder: 0 },
    { id: "demo-tt-closing", eventId: "demo-event-closing", name: "ผู้เข้าร่วม", capacity: 500, sortOrder: 0 },
  ];
  for (const t of types) tx.insert(s.eventTicketType).values(t).run();

  let n = 0;
  const ticket = (eventId: string, typeId: string, userId: string) => {
    n += 1;
    const id = `demo-ticket-${n}`;
    tx.insert(s.eventTicket)
      .values({ id, eventId, ticketTypeId: typeId, userId, code: s.newTicketCode(), createdAt: at(-5 + (n % 5), "19:00") })
      .run();
    return id;
  };
  ticket("demo-event-opening", "demo-tt-opening-general", participant.id);
  ticket("demo-event-football", "demo-tt-football-fan", participant.id);
  ticket("demo-event-football", "demo-tt-football-fan", participant.id);
  ticket("demo-event-opening", "demo-tt-opening-general", athlete.id);
  ticket("demo-event-football", "demo-tt-football-athlete", athlete.id);
  ticket("demo-event-opening", "demo-tt-opening-staff", techStaff.id);
  for (const p of [p01, p03, p05]) ticket("demo-event-football", "demo-tt-football-athlete", p.id);
  for (const p of [p02, p04, p06]) ticket("demo-event-rov", "demo-tt-rov", p.id);
  const checkedIn = CROWD.map((p) => ticket("demo-event-opening", "demo-tt-opening-general", p.id));
  for (const [i, ticketId] of checkedIn.slice(0, 6).entries()) {
    const userId = CROWD[i]?.id ?? "";
    tx.insert(s.eventCheckin)
      .values({ id: `demo-checkin-${i}`, eventId: "demo-event-opening", userId, ticketId, method: "scan", checkedInBy: techStaff.id })
      .run();
  }

  // Calendar.
  const calendar: (typeof s.calendarItem.$inferInsert & { id: string; with?: string[] })[] = [
    { id: "demo-cal-1", departmentId: dept("art"), title: "ประชุมออกแบบฉากพิธีเปิด", status: "confirmed", startAt: at(1, "13:00"), endAt: at(1, "15:00"), venue: "ห้องประชุม E-12", ownerId: artHead.id, createdById: artHead.id, notes: "เตรียมร่างฉากและโทนสีมาคุยกัน", with: ["production"] },
    { id: "demo-cal-2", departmentId: dept("art"), title: "ส่งไฟล์โปสเตอร์ให้ PR", status: "draft", startAt: at(3, "10:00"), endAt: at(3, "11:00"), ownerId: artStaff.id, createdById: artStaff.id, with: ["pr"] },
    { id: "demo-cal-3", departmentId: dept("art"), title: "ทาสีป้ายจุดลงทะเบียน", status: "confirmed", startAt: at(6, "09:00"), endAt: at(6, "16:00"), venue: "ลานกิจกรรมคณะไอที", ownerId: artStaff.id, createdById: artHead.id },
    { id: "demo-cal-4", departmentId: dept("tech-live"), title: "ซ้อมระบบถ่ายทอดสด", status: "confirmed", startAt: at(2, "18:00"), endAt: at(2, "21:00"), venue: "หอประชุม สจล.", ownerId: techHead.id, createdById: techHead.id, with: ["production"] },
    { id: "demo-cal-5", departmentId: dept("tech-live"), title: "ติดตั้ง Kiosk เช็คอินหน้าหอประชุม", status: "confirmed", startAt: at(15, "15:00"), endAt: at(15, "18:00"), venue: "หอประชุม สจล.", ownerId: techStaff.id, createdById: techHead.id, with: ["registration"] },
    { id: "demo-cal-6", departmentId: dept("registration"), title: "ปิดรับสมัครนักกีฬา", status: "confirmed", startAt: at(5, "23:00"), endAt: at(5, "23:59"), ownerId: regHead.id, createdById: regHead.id },
    { id: "demo-cal-7", departmentId: dept("registration"), title: "ตรวจเอกสารนักกีฬา มจธ.", status: "draft", startAt: at(7, "13:00"), endAt: at(7, "17:00"), ownerId: PERSONAS.regOther.id, createdById: regHead.id },
    { id: "demo-cal-8", departmentId: dept("pr"), title: "ถ่ายทำคลิปโปรโมต", status: "cancelled", startAt: at(4, "09:00"), endAt: at(4, "12:00"), createdById: techHead.id },
    { id: "demo-cal-9", departmentId: dept("art"), title: "ซ้อมใหญ่พิธีเปิด", status: "confirmed", startAt: at(15, "08:00"), endAt: at(15, "17:00"), venue: "หอประชุม สจล.", ownerId: artHead.id, createdById: artHead.id, with: ["ceremony", "tech-live"] },
  ];
  for (const { with: collaborators = [], ...item } of calendar) {
    tx.insert(s.calendarItem).values(item).run();
    for (const code of collaborators) {
      tx.insert(s.calendarItemCollaborator).values({ id: `${item.id}-${code}`, itemId: item.id, departmentId: dept(code) }).run();
    }
  }

  // Short links with a week of visits.
  const links: (typeof s.shortLink.$inferInsert)[] = [
    { id: "demo-link-poster", slug: "poster", title: "โปสเตอร์พิธีเปิด", destination: "https://example.com/it3k/poster.pdf", tags: ["pr", "พิธีเปิด"], ownerId: artStaff.id },
    { id: "demo-link-register", slug: "register", title: "ลงทะเบียนผู้เข้าร่วม", destination: "http://localhost:3001/signup", tags: ["ทะเบียน"], ownerId: techHead.id },
    { id: "demo-link-live", slug: "live", title: "ถ่ายทอดสดพิธีเปิด", destination: "https://example.com/it3k/live", tags: ["live"], ownerId: techStaff.id, fallbackUrl: "http://localhost:3001/events/opening-ceremony" },
    { id: "demo-link-staff-form", slug: "staff-form", title: "ฟอร์มสตาฟ (ปิดแล้ว)", destination: "https://example.com/it3k/staff-form", tags: ["สตาฟ"], ownerId: techHead.id, enabled: false },
    { id: "demo-link-photos", slug: "photos", title: "รูปงานวันแรก", destination: "https://example.com/it3k/photos", tags: ["pr"], ownerId: artStaff.id, expiresAt: at(30, "23:59") },
  ];
  for (const link of links) tx.insert(s.shortLink).values(link).run();
  const visits = [42, 58, 31, 77, 64, 90, 120];
  for (const [i, count] of visits.entries()) {
    for (const [linkId, scale] of [["demo-link-poster", 1], ["demo-link-register", 2], ["demo-link-live", 0.5]] as const) {
      tx.insert(s.shortLinkVisitDay).values({ linkId, day: bangkokDay(i - 6), source: "qr", count: Math.round(count * scale) }).run();
      tx.insert(s.shortLinkVisitDay).values({ linkId, day: bangkokDay(i - 6), source: "link", count: Math.round(count * scale * 0.4) }).run();
    }
  }

  // Invitations.
  tx.insert(s.invitation)
    .values([
      { id: "demo-invite-1", email: "volunteer.art@example.test", kind: "staff", departmentId: dept("art"), institution: "kmitl", invitedBy: techHead.id, expiresAt: at(12) },
      { id: "demo-invite-2", email: "coach.kmutnb@example.test", kind: "athlete", institution: "kmutnb-bangkok", invitedBy: regHead.id, expiresAt: at(9) },
      { id: "demo-invite-3", email: "sponsor.contact@example.test", kind: "guest", invitedBy: techHead.id, createdAt: at(-20), expiresAt: at(-6) },
      { id: "demo-invite-4", email: "old.address@example.test", kind: "participant", invitedBy: regHead.id, expiresAt: at(5), revokedAt: at(-1) },
    ])
    .run();

  // A sent email.
  tx.insert(s.emailCampaign)
    .values({
      id: "demo-email-1",
      subject: "ยืนยันกำหนดการพิธีเปิด IT3Kings ครั้งที่ 21",
      content: doc("สวัสดีผู้เข้าร่วมทุกคน", "พิธีเปิดจะเริ่มเวลา 08:30 น. ที่หอประชุม สจล. อย่าลืมเปิดตั๋วในหน้า “ตั๋วของฉัน” เพื่อเช็คอินนะครับ"),
      audience: { kind: "participants", institutions: [] },
      recipientCount: profiles.length,
      sentCount: profiles.length,
      sentBy: techHead.id,
      senderName: techHead.name,
      createdAt: at(-2, "18:30"),
    })
    .run();

  // A knockout bracket: two semi-finals (the first played), the final the
  // first winner already moved into, and the third-place match.
  const badminton = division("badminton-singles-female").id;
  const team = (institution: "kmitl" | "kmutt" | "kmutnb-bangkok", seq: number) => {
    const id = `demo-team-badminton-${institution}-${seq}`;
    tx.insert(s.competitionTeam)
      .values({ id, divisionId: badminton, institution, seq })
      .run();
    return id;
  };
  const kmitl1 = team("kmitl", 1);
  const kmitl2 = team("kmitl", 2);
  const kmutt1 = team("kmutt", 1);
  const kmutnb1 = team("kmutnb-bangkok", 1);
  const match = (
    id: string,
    matchNo: number,
    stageName: string,
    startAt: Date,
    extra: Partial<typeof s.competitionMatch.$inferInsert> = {},
  ) =>
    tx
      .insert(s.competitionMatch)
      .values({
        id,
        divisionId: badminton,
        stageName,
        matchNo,
        roundNo: matchNo > 2 ? 2 : 1,
        startAt,
        venueId: "demo-venue-gym",
        court: `คอร์ท ${((matchNo - 1) % 2) + 1}`,
        createdBy: techHead.id,
        ...extra,
      })
      .run();
  match("demo-match-sf1", 1, "รอบรองชนะเลิศ", at(-1, "10:00"), {
    status: "finished",
    outcome: "played",
    startedAt: at(-1, "10:05"),
    finishedAt: at(-1, "10:50"),
  });
  // Starts soon after the seed runs, so its check-in is open for the screenshots.
  const soon = new Date(Math.ceil((Date.now() + 30 * 60_000) / 300_000) * 300_000);
  match("demo-match-sf2", 2, "รอบรองชนะเลิศ", soon);
  match("demo-match-final", 3, "ชิงชนะเลิศ", at(2, "14:00"));
  match("demo-match-third", 4, "ชิงอันดับ 3", at(2, "13:00"));
  const member = (teamId: string, p: Persona, code: string) =>
    tx
      .insert(s.competitionTeamMember)
      .values({
        teamId,
        registrationId: `demo-reg-${p.id}-${code}`,
        userId: p.id,
        displayName: p.name.split(" ")[0] ?? p.name,
      })
      .run();
  member(kmitl1, p02, "badminton-singles-female");
  member(kmutt1, p10, "badminton-singles-female");
  tx.insert(s.competitionMatchParticipant)
    .values([
      { matchId: "demo-match-sf1", slot: 1, teamId: kmitl1, score: 2, outcome: "win", rank: 1 },
      { matchId: "demo-match-sf1", slot: 2, teamId: kmutnb1, score: 0, outcome: "loss", rank: 2 },
      { matchId: "demo-match-sf2", slot: 1, teamId: kmutt1 },
      { matchId: "demo-match-sf2", slot: 2, teamId: kmitl2 },
      { matchId: "demo-match-final", slot: 1, teamId: kmitl1, label: "ผู้ชนะ M1", sourceMatchId: "demo-match-sf1", sourceResult: "winner" },
      { matchId: "demo-match-final", slot: 2, label: "ผู้ชนะ M2", sourceMatchId: "demo-match-sf2", sourceResult: "winner" },
      { matchId: "demo-match-third", slot: 1, teamId: kmutnb1, label: "ผู้แพ้ M1", sourceMatchId: "demo-match-sf1", sourceResult: "loser" },
      { matchId: "demo-match-third", slot: 2, label: "ผู้แพ้ M2", sourceMatchId: "demo-match-sf2", sourceResult: "loser" },
    ])
    .run();
});

writeFileSync(SESSIONS_FILE, `${JSON.stringify(sessions, null, 2)}\n`);
console.log(`Seeded ${ALL_ACCOUNTS.length} demo accounts into ${file}`);
console.log(`Session tokens written to ${SESSIONS_FILE} (gitignored).`);
