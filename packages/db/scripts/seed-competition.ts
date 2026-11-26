/**
 * Local dev only: fills the `alchemy dev` D1 with made-up competition data for
 * trying the teams, matches, check-in, scoring and public pages by hand.
 *
 *   bun packages/db/scripts/seed-competition.ts          # (re)seed
 *   bun packages/db/scripts/seed-competition.ts --clear  # remove it all
 *
 * Every row it makes has an id starting with `mock-`, and every made-up account
 * is on example.test. Re-running it first clears the mock rows AND every row in
 * the competition_* tables (they hold nothing but test data locally), so the
 * walk-through starts clean each time. Real accounts are never touched.
 *
 * It also writes signed session cookies for the staff personas to
 * packages/infra/.alchemy/local/mock-sessions.json (gitignored), so a private
 * window can act as กีฬา head, กีฬา staff and so on. Times are relative to now
 * (Bangkok), so a scheduled match always has its check-in window open.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { and, eq, inArray, isNotNull, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";

import type {
  MatchOutcome,
  MatchStatus,
  ParticipantOutcome,
  ScoreEventPayload,
  SideSource,
} from "../src/competition-rules";
import { SIDE_SOURCE_LABELS } from "../src/competition-rules";
import { findLocalD1 } from "../src/local-d1";
import type { Institution, ProfileValues } from "../src/profile";
import * as s from "../src/schema/index";
import { computeMatchState } from "../src/scoring/index";
import { resolveScoringConfig } from "../src/scoring/presets";

const clearOnly = process.argv.includes("--clear");
const file = findLocalD1();
const sqlite = new Database(file);
sqlite.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
const db = drizzle({ client: sqlite });

// ── Time: relative to now, in Bangkok ──────────────────────────────────────
const NOW = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const bangkokMidnight = (() => {
  const now = new Date(NOW + 7 * 3_600_000);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 7 * 3_600_000;
})();
const inMinutes = (minutes: number) => new Date(NOW + minutes * MIN);
/** `days` from today at `hh:mm` Bangkok time. */
const at = (days: number, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return new Date(bangkokMidnight + days * DAY + ((h ?? 0) * 60 + (m ?? 0)) * MIN);
};

// ── Lookups ────────────────────────────────────────────────────────────────
const departments = db.select().from(s.department).all();
const deptId = (code: string) => {
  const row = departments.find((d) => d.code === code);
  if (!row) throw new Error(`No department with code ${code}; are the migrations applied?`);
  return row.id;
};
const divisions = db.select().from(s.sportDivision).all();
const division = (code: string) => {
  const row = divisions.find((d) => d.code === code);
  if (!row) throw new Error(`No sport division ${code}; are the seed migrations applied?`);
  return row;
};

// ── Clear ──────────────────────────────────────────────────────────────────
function clear() {
  db.transaction((tx) => {
    for (const table of [
      s.competitionChange,
      s.competitionScoreEvent,
      s.competitionMatchCheckin,
      s.competitionLineup,
      s.competitionMatchReferee,
      s.competitionMatchImage,
      s.competitionPlacement,
      s.competitionGroupTeam,
      s.competitionMatchParticipant,
    ]) {
      tx.delete(table).run();
    }
    tx.delete(s.competitionMatch).where(isNotNull(s.competitionMatch.parentMatchId)).run();
    tx.delete(s.competitionMatch).run();
    tx.delete(s.competitionGroup).run();
    tx.delete(s.competitionTeamOfficial).run();
    tx.delete(s.competitionTeamMember).run();
    tx.delete(s.competitionTeam).run();
    tx.delete(s.leadership).where(like(s.leadership.id, "mock-%")).run();
    // Registrations have no ON DELETE from divisions, but do cascade from users.
    tx.delete(s.sportRegistration)
      .where(or(like(s.sportRegistration.id, "mock-%"), like(s.sportRegistration.id, "test-%")))
      .run();
    tx.delete(s.user)
      .where(or(like(s.user.id, "mock-%"), like(s.user.id, "test-%")))
      .run();
    tx.delete(s.venue)
      .where(or(like(s.venue.id, "mock-%"), like(s.venue.id, "test-%")))
      .run();
  });
}

clear();
if (clearOnly) {
  console.log("Cleared the mock accounts and every competition row.");
  process.exit(0);
}

// ── People ─────────────────────────────────────────────────────────────────
type Gender = "male" | "female";
const FIRST: Record<Gender, string[]> = {
  male: [
    "ธนา",
    "ภูมิ",
    "กิตติ",
    "ณัฐ",
    "ปกรณ์",
    "วีระ",
    "อนันต์",
    "ชยพล",
    "ศุภชัย",
    "พีระ",
    "ก้อง",
    "ต้นกล้า",
    "ภาคิน",
    "ธีร์",
    "ชินวัตร",
  ],
  female: [
    "พิมพ์ชนก",
    "กัญญา",
    "ณัฐธิดา",
    "ปวีณา",
    "สุภาวดี",
    "อรุณี",
    "ชลิดา",
    "วรรณา",
    "มณีรัตน์",
    "จิราพร",
    "ศิริพร",
    "นภัสสร",
    "แพรวา",
    "ขวัญข้าว",
    "ปาริชาต",
  ],
};
const LAST: Record<Institution, string> = {
  kmitl: "ลาดกระบัง",
  kmutt: "บางมด",
  "kmutnb-bangkok": "พระนครเหนือ",
  "kmutnb-prachinburi": "ปราจีนบุรี",
};
const INSTITUTIONS = ["kmitl", "kmutt", "kmutnb-bangkok"] as const satisfies Institution[];
type Inst = (typeof INSTITUTIONS)[number];

const accounts: {
  id: string;
  name: string;
  role: string;
  institution: Institution;
  departmentId?: string;
}[] = [];
const profiles: { userId: string; values: ProfileValues }[] = [];
const athleteRows: { userId: string; studentId: string }[] = [];
const registrations: (typeof s.sportRegistration.$inferInsert)[] = [];

function person(
  id: string,
  first: string,
  institution: Institution,
  gender: Gender,
  role: string,
  departmentId?: string,
) {
  const last = `${LAST[institution]}${id.slice(-2).replace(/\D/g, "")}`;
  accounts.push({ id, name: `${first} ${last}`, role, institution, departmentId });
  profiles.push({
    userId: id,
    values: {
      prefix: gender === "male" ? "นาย" : "นางสาว",
      firstName: first,
      lastName: last,
      nickname: "",
      phone: "0812345678",
      photoFileId: "",
      medicalConditions: "",
      drugAllergies: "",
      foodAllergies: "",
      dietaryRestrictions: "",
      institution,
    },
  });
}

/** Approved athletes of one division and institution; returns their ids and registrations. */
function athletes(code: string, institution: Institution, count: number, gender: Gender | "mixed") {
  const div = division(code);
  const out: { userId: string; registrationId: string; first: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const g: Gender = gender === "mixed" ? (i % 2 ? "male" : "female") : gender;
    const userId = `mock-ath-${code}-${institution}-${String(i).padStart(2, "0")}`;
    const registrationId = `mock-reg-${code}-${institution}-${String(i).padStart(2, "0")}`;
    const names = FIRST[g];
    const first =
      names[(i - 1 + INSTITUTIONS.indexOf(institution as Inst) * 5) % names.length] ?? "นักกีฬา";
    person(userId, first, institution, g, "participant,athlete");
    athleteRows.push({
      userId,
      studentId: `6${String(INSTITUTIONS.indexOf(institution as Inst))}0${String(i).padStart(5, "0")}`,
    });
    registrations.push({
      id: registrationId,
      userId,
      divisionId: div.id,
      institution,
      status: "approved",
      shirtNumber: div.requiresShirtNumber ? i * 2 + 1 : null,
      reviewedAt: new Date(NOW - DAY),
    });
    out.push({ userId, registrationId, first });
  }
  return out;
}

// Staff personas, signed in through mock-sessions.json.
const PERSONAS = [
  {
    id: "mock-admin",
    first: "แอดมิน",
    dept: "tech-live",
    seat: false,
    institution: "kmitl",
    role: "admin",
    note: "Admin (อนุมัติ แก้ไขนักกีฬา และทำได้ทุกอย่าง)",
  },
  {
    id: "mock-sports-head",
    first: "สมศักดิ์",
    dept: "sports",
    seat: true,
    institution: "kmitl",
    note: "หัวหน้าฝ่ายกีฬา สจล.",
  },
  {
    id: "mock-sports-staff",
    first: "สมใจ",
    dept: "sports",
    seat: false,
    institution: "kmitl",
    note: "สตาฟฝ่ายกีฬา สจล. (ใส่คะแนนได้ เช็คอินไม่ได้)",
  },
  {
    id: "mock-tech-staff",
    first: "เทคโน",
    dept: "tech-live",
    seat: false,
    institution: "kmitl",
    note: "สตาฟ Tech/Live (ได้ทุกสิทธิ์แข่งขัน)",
  },
  {
    id: "mock-reg-staff",
    first: "ทะเบียน",
    dept: "registration",
    seat: false,
    institution: "kmitl",
    note: "สตาฟทะเบียน สจล. (ดู ใส่คะแนน เช็คอิน)",
  },
  {
    id: "mock-reg-kmutt",
    first: "บางมด",
    dept: "registration",
    seat: false,
    institution: "kmutt",
    note: "สตาฟทะเบียน มจธ. (ไม่เห็นระบบแข่งขัน)",
  },
  {
    id: "mock-art-staff",
    first: "ศิลป์",
    dept: "art",
    seat: false,
    institution: "kmitl",
    note: "สตาฟฝ่าย Art (ไม่มีสิทธิ์กีฬา)",
  },
] as const;
for (const p of PERSONAS) {
  person(p.id, p.first, p.institution, "male", "role" in p ? p.role : "staff", deptId(p.dept));
}

// ── Competition data ───────────────────────────────────────────────────────
type TeamRef = {
  id: string;
  institution: Institution;
  members: { userId: string; registrationId: string; first: string }[];
};
const teams: (typeof s.competitionTeam.$inferInsert)[] = [];
const members: (typeof s.competitionTeamMember.$inferInsert)[] = [];
const officials: (typeof s.competitionTeamOfficial.$inferInsert)[] = [];
const groups: (typeof s.competitionGroup.$inferInsert)[] = [];
const groupTeams: (typeof s.competitionGroupTeam.$inferInsert)[] = [];
const matches: (typeof s.competitionMatch.$inferInsert)[] = [];
const sides: (typeof s.competitionMatchParticipant.$inferInsert)[] = [];
const lineups: (typeof s.competitionLineup.$inferInsert)[] = [];
const checkins: (typeof s.competitionMatchCheckin.$inferInsert)[] = [];
const events: (typeof s.competitionScoreEvent.$inferInsert)[] = [];
const referees: (typeof s.competitionMatchReferee.$inferInsert)[] = [];
const placements: (typeof s.competitionPlacement.$inferInsert)[] = [];

function team(
  code: string,
  institution: Institution,
  roster: TeamRef["members"],
  seq = 1,
  withOfficials = 0,
): TeamRef {
  const id = `mock-team-${code}-${institution}-${seq}`;
  teams.push({ id, divisionId: division(code).id, institution, seq, name: null });
  roster.forEach((m, i) =>
    members.push({
      teamId: id,
      registrationId: m.registrationId,
      userId: m.userId,
      displayName: m.first,
      sortOrder: i,
    }),
  );
  const roles = ["ผู้ฝึกสอน", "ผู้จัดการทีม", "ผู้ช่วยผู้ฝึกสอน"];
  for (let i = 0; i < withOfficials; i++) {
    officials.push({
      id: `${id}-official-${i + 1}`,
      teamId: id,
      name: `อาจารย์${["วิชัย", "สุดา", "ประเสริฐ"][i] ?? "ทดสอบ"} ${LAST[institution]}`,
      position: roles[i] ?? "เจ้าหน้าที่ทีม",
      description: i === 0 ? "ดูแลการฝึกซ้อมและวางแผนการแข่งขัน" : null,
      photoUrl: null,
      sortOrder: i,
    });
  }
  return { id, institution, members: roster };
}

/** A match with its sides. `events` builds score events; status decides what is stored. */
function match(opts: {
  id: string;
  code: string;
  teams: TeamRef[];
  stageName: string;
  startAt: Date | null;
  status: MatchStatus;
  venueId?: string | null;
  court?: string | null;
  groupId?: string | null;
  roundNo?: number | null;
  matchNo?: number | null;
  friendly?: boolean;
  labels?: string[];
  /** Knockout sides: the winner or loser of an earlier match. */
  sources?: { matchId: string; result: SideSource }[];
  play?: (
    side: (i: number) => string,
    regOf: (i: number, n: number) => string,
  ) => ScoreEventPayload[];
}) {
  const div = division(opts.code);
  matches.push({
    id: opts.id,
    divisionId: div.id,
    stageName: opts.stageName,
    groupId: opts.groupId ?? null,
    roundNo: opts.roundNo ?? null,
    matchNo: opts.matchNo ?? null,
    startAt: opts.startAt,
    venueId: opts.venueId ?? null,
    court: opts.court ?? null,
    status: "scheduled",
    friendly: opts.friendly ?? false,
    createdBy: "mock-sports-head",
  });
  const participantIds: string[] = [];
  const count = opts.sources?.length ?? opts.labels?.length ?? opts.teams.length;
  for (let i = 0; i < count; i++) {
    const pid = `${opts.id}-p${i + 1}`;
    participantIds.push(pid);
    const source = opts.sources?.[i];
    sides.push({
      id: pid,
      matchId: opts.id,
      teamId: source
        ? advanced(source.matchId, source.result)
        : opts.labels
          ? null
          : (opts.teams[i]?.id ?? null),
      // Named after its source, as the API names a sourced side.
      label: source ? sourceLabel(source.matchId, source.result) : (opts.labels?.[i] ?? null),
      slot: i + 1,
      sourceMatchId: source?.matchId ?? null,
      sourceResult: source?.result ?? null,
    });
  }
  if (!opts.play || opts.status === "scheduled" || opts.status === "checkin") {
    const m = matches.at(-1);
    if (m) m.status = opts.status;
    return participantIds;
  }

  const payloads = opts.play(
    (i) => participantIds[i] ?? "",
    (i, n) => opts.teams[i]?.members[n]?.registrationId ?? "",
  );
  const started = opts.startAt ?? new Date(NOW);
  const records = payloads.map((payload, k) => ({
    id: crypto.randomUUID(),
    seq: k + 1,
    payload,
    voided: false,
    createdAt: started.getTime() + (k + 1) * 90_000,
  }));
  for (const r of records) {
    const p = r.payload as Record<string, unknown>;
    events.push({
      id: r.id,
      matchId: opts.id,
      seq: r.seq,
      type: r.payload.type,
      participantId: typeof p.participantId === "string" ? p.participantId : null,
      registrationId: typeof p.registrationId === "string" ? p.registrationId : null,
      payload: r.payload,
      createdBy: "mock-sports-staff",
      clientCreatedAt: new Date(r.createdAt),
      createdAt: new Date(r.createdAt),
    });
  }
  const config = resolveScoringConfig({ scoringConfig: null }, div);
  const state = computeMatchState({
    config,
    participants: participantIds.map((id) => ({ id })),
    events: records,
  });
  if (opts.status === "finished" && !state.decided) {
    throw new Error(`${opts.id}: the mock events do not decide the match`);
  }
  const m = matches.at(-1);
  if (m) {
    // The same columns resultStatements writes.
    m.status = opts.status;
    m.outcome = (opts.status === "finished" ? "played" : null) as MatchOutcome | null;
    m.liveState = {
      period: state.period,
      phase: state.phase,
      decided: state.decided,
      clock: state.clock,
      timeline: state.timeline,
    };
    m.scoreSeq = records.length;
    m.startedAt = started;
    m.finishedAt =
      opts.status === "finished"
        ? new Date(started.getTime() + (records.length + 2) * 90_000)
        : null;
  }
  for (const side of state.participants) {
    const row = sides.find((x) => x.id === side.participantId);
    if (row)
      Object.assign(row, {
        score: side.score,
        detail: side.detail,
        resultValue: side.resultValue,
        rank: side.rank,
        outcome: side.outcome,
      });
  }
  return participantIds;
}

/** The team a finished match already sent on, as resultStatements' auto-advance would. */
function advanced(matchId: string, result: SideSource): string | null {
  const outcomes: ParticipantOutcome[] =
    result === "winner" ? ["win", "walkover_win"] : ["loss", "forfeit"];
  const hits = sides.filter(
    (x) => x.matchId === matchId && x.outcome && outcomes.includes(x.outcome),
  );
  return hits.length === 1 ? (hits[0]?.teamId ?? null) : null;
}

function sourceLabel(matchId: string, result: SideSource): string {
  const source = matches.find((m) => m.id === matchId);
  const what = source?.matchNo != null ? `M${source.matchNo}` : (source?.stageName ?? "");
  return `${SIDE_SOURCE_LABELS[result]} ${what}`;
}

const score = (
  participantId: string,
  points = 1,
  registrationId: string | null = null,
): ScoreEventPayload => ({
  type: "score",
  participantId,
  points,
  registrationId,
});
const period = (n: number): ScoreEventPayload => ({ type: "period", period: n });
const game = (participantId: string): ScoreEventPayload => ({ type: "game", participantId });
const rally = (participantId: string, n: number) =>
  Array.from({ length: n }, () => score(participantId));

// Venues
const venues = [
  { id: "mock-venue-field", name: "สนามฟุตบอลกลาง (mock)", description: "สนามหญ้าหน้าหอประชุม" },
  { id: "mock-venue-gym", name: "โรงยิมเนเซียม (mock)", description: "คอร์ทแบด 1–4 และคอร์ทบาส" },
  { id: "mock-venue-track", name: "ลู่วิ่งกรีฑา (mock)", description: null },
];

// 1) บาส 3x3 หญิง: ยังไม่มีทีม ไว้ลองตั้งแต่ต้น
for (const inst of INSTITUTIONS) athletes("basketball-3x3-female", inst, 4, "female");

// 2) ฟุตบอล: กลุ่ม A ครบ 3 แมตช์ (จบแล้ว / กำลังแข่ง / เปิดรายงานตัว) และนัดชิงที่ยังรอทีม
const fb = Object.fromEntries(
  INSTITUTIONS.map((inst) => [
    inst,
    team("football", inst, athletes("football", inst, 14, "male"), 1, 2),
  ]),
) as Record<Inst, TeamRef>;
groups.push({
  id: "mock-group-football-a",
  divisionId: division("football").id,
  stageName: "รอบแบ่งกลุ่ม",
  name: "A",
  sortOrder: 0,
});
INSTITUTIONS.forEach((inst, i) =>
  groupTeams.push({ groupId: "mock-group-football-a", teamId: fb[inst].id, seed: i + 1 }),
);
const fbBase = {
  code: "football",
  stageName: "รอบแบ่งกลุ่ม",
  venueId: "mock-venue-field",
  court: "สนาม 1",
  groupId: "mock-group-football-a",
};
match({
  ...fbBase,
  id: "mock-match-fb-1",
  teams: [fb.kmitl, fb.kmutt],
  roundNo: 1,
  matchNo: 1,
  startAt: at(-1, "15:00"),
  status: "finished",
  play: (p, r) => [
    score(p(0), 1, r(0, 9)),
    period(2),
    score(p(1), 1, r(1, 8)),
    score(p(0), 1, r(0, 10)),
    period(3),
  ],
});
match({
  ...fbBase,
  id: "mock-match-fb-2",
  teams: [fb.kmutt, fb["kmutnb-bangkok"]],
  roundNo: 2,
  matchNo: 2,
  startAt: inMinutes(-20),
  status: "live",
  play: (p, r) => [
    score(p(0), 1, r(0, 9)),
    { type: "stat", participantId: p(1), stat: "yellow", registrationId: r(1, 4) },
  ],
});
const fb3 = match({
  ...fbBase,
  id: "mock-match-fb-3",
  teams: [fb.kmitl, fb["kmutnb-bangkok"]],
  roundNo: 3,
  matchNo: 3,
  startAt: inMinutes(35),
  status: "checkin",
});
// Lineups for the match whose check-in is open: 11 starters and 3 subs a side.
[fb.kmitl, fb["kmutnb-bangkok"]].forEach((t, i) =>
  t.members.forEach((m, n) =>
    lineups.push({
      participantId: fb3[i] ?? "",
      matchId: "mock-match-fb-3",
      registrationId: m.registrationId,
      role: n < 11 ? "starter" : "sub",
    }),
  ),
);
// สจล. already has 8 of 11 checked in; มจพ. has nobody yet.
fb.kmitl.members.slice(0, 8).forEach((m, n) =>
  checkins.push({
    id: `mock-checkin-fb3-${n}`,
    matchId: "mock-match-fb-3",
    participantId: fb3[0] ?? "",
    userId: m.userId,
    method: "scan",
    checkedInBy: "mock-tech-staff",
    createdAt: inMinutes(-5 + n * 0.3),
  }),
);
match({
  code: "football",
  id: "mock-match-fb-final",
  teams: [],
  labels: ["อันดับ 1 กลุ่ม A", "อันดับ 2 กลุ่ม A"],
  stageName: "ชิงชนะเลิศ",
  matchNo: 4,
  startAt: at(2, "16:00"),
  venueId: "mock-venue-field",
  court: "สนาม 1",
  status: "scheduled",
});
for (const [i, role] of ["ผู้ตัดสิน", "ผู้กำกับเส้น", "ผู้กำกับเส้น"].entries()) {
  referees.push({
    id: `mock-ref-fb-1-${i}`,
    matchId: "mock-match-fb-1",
    name: `กรรมการ${["สมชาย", "ประยุทธ", "วิไล"][i]}`,
    role,
    sortOrder: i,
  });
}

// 3) แบดมินตันเดี่ยวหญิง: สจล. 2 ทีม แข่งเป็นเซต
const bd = {
  kmitl1: team(
    "badminton-singles-female",
    "kmitl",
    athletes("badminton-singles-female", "kmitl", 2, "female").slice(0, 1),
    1,
  ),
  // มจธ. has a second approved athlete in no team, for trying จัดทีมอัตโนมัติ.
  kmutt: team(
    "badminton-singles-female",
    "kmutt",
    athletes("badminton-singles-female", "kmutt", 2, "female").slice(0, 1),
    1,
  ),
  "kmutnb-bangkok": team(
    "badminton-singles-female",
    "kmutnb-bangkok",
    athletes("badminton-singles-female", "kmutnb-bangkok", 1, "female"),
    1,
  ),
};
const bdKmitl2 = team(
  "badminton-singles-female",
  "kmitl",
  registrationsFor("badminton-singles-female", "kmitl").slice(1, 2),
  2,
);
function registrationsFor(code: string, inst: Institution): TeamRef["members"] {
  return registrations
    .filter((r) => r.id?.startsWith(`mock-reg-${code}-${inst}-`))
    .map((r) => ({
      userId: r.userId,
      registrationId: r.id ?? "",
      first: profiles.find((p) => p.userId === r.userId)?.values.firstName ?? "",
    }));
}
match({
  id: "mock-match-bd-1",
  code: "badminton-singles-female",
  teams: [bd.kmitl1, bd.kmutt],
  stageName: "รอบแรก",
  matchNo: 1,
  startAt: at(0, "09:00"),
  venueId: "mock-venue-gym",
  court: "คอร์ท 1",
  status: "finished",
  play: (p) => [
    ...rally(p(0), 10),
    ...rally(p(1), 10),
    ...rally(p(0), 5),
    ...rally(p(0), 8),
    ...rally(p(1), 12),
    ...rally(p(0), 7),
  ],
});
match({
  id: "mock-match-bd-2",
  code: "badminton-singles-female",
  teams: [bdKmitl2, bd["kmutnb-bangkok"]],
  stageName: "รอบแรก",
  matchNo: 2,
  startAt: at(1, "10:00"),
  venueId: "mock-venue-gym",
  court: "คอร์ท 2",
  status: "scheduled",
});
// สายน็อกเอาต์: ผู้ชนะ M1 กับ M2 ชิง ผู้แพ้ชิงที่ 3 (M1 จบแล้ว ผู้ชนะจึงเลื่อนเข้าชิงไว้แล้ว)
const bdKnockout = (result: SideSource) => [
  { matchId: "mock-match-bd-1", result },
  { matchId: "mock-match-bd-2", result },
];
match({
  id: "mock-match-bd-final",
  code: "badminton-singles-female",
  teams: [],
  sources: bdKnockout("winner"),
  stageName: "ชิงชนะเลิศ",
  matchNo: 4,
  startAt: at(2, "14:00"),
  venueId: "mock-venue-gym",
  court: "คอร์ท 1",
  status: "scheduled",
});
match({
  id: "mock-match-bd-third",
  code: "badminton-singles-female",
  teams: [],
  sources: bdKnockout("loser"),
  stageName: "ชิงอันดับ 3",
  matchNo: 3,
  startAt: at(2, "13:00"),
  venueId: "mock-venue-gym",
  court: "คอร์ท 2",
  status: "scheduled",
});

// 4) เปตองผสม: นับรายเอนด์ ถึง 13
const pt = Object.fromEntries(
  (["kmutt", "kmutnb-bangkok"] as Institution[]).map((inst) => [
    inst,
    team("petanque-mixed", inst, athletes("petanque-mixed", inst, 3, "mixed")),
  ]),
) as Record<"kmutt" | "kmutnb-bangkok", TeamRef>;
match({
  id: "mock-match-pt-1",
  code: "petanque-mixed",
  teams: [pt.kmutt, pt["kmutnb-bangkok"]],
  stageName: "รอบแรก",
  matchNo: 1,
  startAt: at(0, "10:30"),
  venueId: "mock-venue-field",
  court: "ลานเปตอง",
  status: "finished",
  friendly: true,
  play: (p) => [
    score(p(0), 3),
    score(p(1), 2),
    score(p(0), 4),
    score(p(1), 5),
    score(p(0), 2),
    score(p(0), 4),
  ],
});

// 5) ชักเย่อ: พบกันหมดจบแล้ว และบันทึกอันดับ 1-3 (ขึ้นตารางเหรียญ)
const tw = Object.fromEntries(
  INSTITUTIONS.map((inst) => [
    inst,
    team("folk-tug-of-war", inst, athletes("folk-tug-of-war", inst, 10, "mixed"), 1, 1),
  ]),
) as Record<Inst, TeamRef>;
const twGames = [
  ["mock-match-tw-1", tw.kmitl, tw.kmutt, [0, 1, 0]],
  ["mock-match-tw-2", tw.kmutt, tw["kmutnb-bangkok"], [0, 0]],
  ["mock-match-tw-3", tw.kmitl, tw["kmutnb-bangkok"], [0, 0]],
] as const;
twGames.forEach(([id, a, b, wins], i) =>
  match({
    id,
    code: "folk-tug-of-war",
    teams: [a, b],
    stageName: "พบกันหมด",
    roundNo: i + 1,
    matchNo: i + 1,
    startAt: at(-1, `${9 + i}:00`),
    venueId: "mock-venue-field",
    court: "ลานชักเย่อ",
    status: "finished",
    play: (p) => wins.map((w) => game(p(w))),
  }),
);
[tw.kmitl, tw.kmutt, tw["kmutnb-bangkok"]].forEach((t, i) =>
  placements.push({
    teamId: t.id,
    divisionId: division("folk-tug-of-war").id,
    place: i + 1,
    updatedBy: "mock-sports-head",
  }),
);

// 6) วิ่ง 100 ม. ชาย: จับเวลา และบันทึกอันดับ
const ath = INSTITUTIONS.map((inst) =>
  team("athletics-100m-male", inst, athletes("athletics-100m-male", inst, 1, "male")),
);
const times = [11_420, 11_870, 11_650];
match({
  id: "mock-match-ath-1",
  code: "athletics-100m-male",
  teams: ath,
  stageName: "รอบชิงชนะเลิศ",
  matchNo: 1,
  startAt: at(-1, "08:30"),
  venueId: "mock-venue-track",
  court: "ลู่ 1-3",
  status: "finished",
  play: (p) =>
    times.map(
      (ms, i) =>
        ({ type: "result", participantId: p(i), value: ms, status: "ok" }) as ScoreEventPayload,
    ),
});
[0, 2, 1].forEach((i, place) =>
  placements.push({
    teamId: ath[i]?.id ?? "",
    divisionId: division("athletics-100m-male").id,
    place: place + 1,
    updatedBy: "mock-sports-head",
  }),
);

// 7) ROV: เช็คอินแบบ manual (Discord) แมตช์อีก 20 นาที
const rov = Object.fromEntries(
  (["kmitl", "kmutnb-bangkok"] as Institution[]).map((inst) => [
    inst,
    team("esports-rov", inst, athletes("esports-rov", inst, 6, "mixed")),
  ]),
) as Record<"kmitl" | "kmutnb-bangkok", TeamRef>;
match({
  id: "mock-match-rov-1",
  code: "esports-rov",
  teams: [rov.kmitl, rov["kmutnb-bangkok"]],
  stageName: "รอบแรก",
  matchNo: 1,
  startAt: inMinutes(20),
  status: "checkin",
  court: "ออนไลน์ (Discord)",
});

// 8) บาส 5x5 ชาย: พร้อมใช้ทันที ไม่ต้องสร้างทีมหรือตารางเอง
//    BK1 อีก 90 นาที (kiosk ยังไม่เปิด, ใส่คะแนนได้) · BK2 อีก 5 นาที รายงานตัวปิดแล้ว
//    มจพ. มาไม่ครบ (ปรับแพ้ได้ทันที) · BK3 พรุ่งนี้ (ลองชนะผ่าน)
//    ทีม มจพ. มีนักกีฬา 1 คนที่ถูกปฏิเสธการสมัครแล้ว (เห็นใน “สิ่งที่ยังไม่ครบ”)
const bk = Object.fromEntries(
  INSTITUTIONS.map((inst) => [
    inst,
    team("basketball-5x5-male", inst, athletes("basketball-5x5-male", inst, 8, "male"), 1, 1),
  ]),
) as Record<Inst, TeamRef>;
const rejected = registrations.find(
  (r) => r.id === "mock-reg-basketball-5x5-male-kmutnb-bangkok-08",
);
if (rejected) rejected.status = "rejected";
groups.push({
  id: "mock-group-basketball-a",
  divisionId: division("basketball-5x5-male").id,
  stageName: "รอบแบ่งกลุ่ม",
  name: "A",
  sortOrder: 0,
});
INSTITUTIONS.forEach((inst, i) =>
  groupTeams.push({ groupId: "mock-group-basketball-a", teamId: bk[inst].id, seed: i + 1 }),
);
const bkBase = {
  code: "basketball-5x5-male",
  stageName: "รอบแบ่งกลุ่ม",
  venueId: "mock-venue-gym",
  court: "คอร์ทบาส",
  groupId: "mock-group-basketball-a",
};
/** Five starters and three subs a side. */
function lineup(matchId: string, participantIds: string[], sideTeams: TeamRef[]) {
  sideTeams.forEach((t, i) =>
    t.members.forEach((m, n) =>
      lineups.push({
        participantId: participantIds[i] ?? "",
        matchId,
        registrationId: m.registrationId,
        role: n < 5 ? "starter" : "sub",
      }),
    ),
  );
}
const bk1 = match({
  ...bkBase,
  id: "mock-match-bk-1",
  teams: [bk.kmitl, bk.kmutt],
  roundNo: 1,
  matchNo: 1,
  startAt: inMinutes(90),
  status: "scheduled",
});
lineup("mock-match-bk-1", bk1, [bk.kmitl, bk.kmutt]);
const bk2 = match({
  ...bkBase,
  id: "mock-match-bk-2",
  teams: [bk.kmutt, bk["kmutnb-bangkok"]],
  roundNo: 2,
  matchNo: 2,
  startAt: inMinutes(5),
  status: "checkin",
});
lineup("mock-match-bk-2", bk2, [bk.kmutt, bk["kmutnb-bangkok"]]);
// มจธ. checked in 6 (needs 5), มจพ. only 2.
const bk2Checkins: [TeamRef, number, number][] = [
  [bk.kmutt, 0, 6],
  [bk["kmutnb-bangkok"], 1, 2],
];
bk2Checkins.forEach(([t, side, n]) =>
  t.members.slice(0, n).forEach((m, k) =>
    checkins.push({
      id: `mock-checkin-bk2-${side}-${k}`,
      matchId: "mock-match-bk-2",
      participantId: bk2[side] ?? "",
      userId: m.userId,
      method: "scan",
      checkedInBy: "mock-reg-staff",
      createdAt: inMinutes(-25 + k),
    }),
  ),
);
match({
  ...bkBase,
  id: "mock-match-bk-3",
  teams: [bk.kmitl, bk["kmutnb-bangkok"]],
  roundNo: 3,
  matchNo: 3,
  startAt: at(1, "13:00"),
  status: "scheduled",
});

// 9) แมตช์ที่ยังไม่แข่ง ไว้ลอง engine คะแนนแต่ละแบบ
match({
  id: "mock-match-pt-2",
  code: "petanque-mixed",
  teams: [pt["kmutnb-bangkok"], pt.kmutt],
  stageName: "รอบแรก",
  matchNo: 2,
  startAt: inMinutes(60),
  venueId: "mock-venue-field",
  court: "ลานเปตอง",
  status: "scheduled",
  friendly: true,
});
match({
  id: "mock-match-tw-4",
  code: "folk-tug-of-war",
  teams: [tw.kmitl, tw.kmutt],
  stageName: "นัดอุ่นเครื่อง",
  matchNo: 4,
  startAt: inMinutes(120),
  venueId: "mock-venue-field",
  court: "ลานชักเย่อ",
  status: "scheduled",
  friendly: true,
});
match({
  id: "mock-match-ath-2",
  code: "athletics-100m-male",
  teams: ath,
  stageName: "รอบอุ่นเครื่อง",
  matchNo: 2,
  startAt: inMinutes(45),
  venueId: "mock-venue-track",
  court: "ลู่ 1-3",
  status: "scheduled",
  friendly: true,
});

// ── Write ──────────────────────────────────────────────────────────────────
const created = new Date(NOW);
db.transaction((tx) => {
  tx.insert(s.venue).values(venues).run();
  for (const a of accounts) {
    tx.insert(s.user)
      .values({
        id: a.id,
        name: a.name,
        email: `${a.id.replace(/^mock-/, "")}@example.test`,
        emailVerified: true,
        role: a.role,
        institution: a.institution,
        departmentId: a.departmentId ?? null,
      })
      .run();
  }
  for (const p of profiles) {
    tx.insert(s.userProfile)
      .values({
        userId: p.userId,
        draft: p.values,
        values: p.values,
        revision: 1,
        dirty: false,
        submittedAt: created,
        updatedAt: created,
      })
      .run();
  }
  if (athleteRows.length) tx.insert(s.athlete).values(athleteRows).run();
  for (const chunk of chunks(registrations, 50)) tx.insert(s.sportRegistration).values(chunk).run();

  // A กีฬา seat for mock-sports-head: a free one, else an unattached seat (it
  // goes back to unattached when --clear deletes the mock user: ON DELETE SET
  // NULL), else none, when real accounts hold both.
  const seats = tx
    .select({ id: s.leadership.id, role: s.leadership.role, userId: s.leadership.userId })
    .from(s.leadership)
    .where(
      and(
        eq(s.leadership.departmentId, deptId("sports")),
        inArray(s.leadership.role, ["head", "vicehead"]),
      ),
    )
    .all();
  const free = (["head", "vicehead"] as const).find((r) => !seats.some((seat) => seat.role === r));
  const unattached = [...seats]
    .sort((a) => (a.role === "vicehead" ? -1 : 1))
    .find((seat) => seat.userId === null);
  if (free) {
    tx.insert(s.leadership)
      .values({
        id: "mock-lead-sports",
        departmentId: deptId("sports"),
        role: free,
        userId: "mock-sports-head",
        name: "สมศักดิ์ ลาดกระบัง",
      })
      .run();
  } else if (unattached) {
    tx.update(s.leadership)
      .set({ userId: "mock-sports-head" })
      .where(eq(s.leadership.id, unattached.id))
      .run();
    console.log(
      `mock-sports-head sits in the unattached กีฬา ${unattached.role} seat until --clear.`,
    );
  } else {
    console.warn("Real accounts hold both กีฬา seats: mock-sports-head holds no seat.");
  }

  for (const [table, rows] of [
    [s.competitionTeam, teams],
    [s.competitionTeamMember, members],
    [s.competitionTeamOfficial, officials],
    [s.competitionGroup, groups],
    [s.competitionGroupTeam, groupTeams],
    [s.competitionMatch, matches],
    [s.competitionMatchParticipant, sides],
    [s.competitionLineup, lineups],
    [s.competitionMatchCheckin, checkins],
    [s.competitionScoreEvent, events],
    [s.competitionMatchReferee, referees],
    [s.competitionPlacement, placements],
  ] as const) {
    // biome-ignore lint/suspicious/noExplicitAny: one loop over differently typed tables
    for (const chunk of chunks(rows as any[], 20))
      tx.insert(table as any)
        .values(chunk)
        .run();
  }
});

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ── Sessions for the staff personas ────────────────────────────────────────
function readAuthSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const env = resolve(import.meta.dirname, "../../../apps/server/.env");
  const line = readFileSync(env, "utf8")
    .split("\n")
    .find((l) => l.startsWith("BETTER_AUTH_SECRET="));
  const value = line
    ?.slice("BETTER_AUTH_SECRET=".length)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`BETTER_AUTH_SECRET is not set in ${env}`);
  return value;
}
async function signed(token: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`);
}

let sessionNote = "";
try {
  const secret = readAuthSecret();
  const out: Record<string, { note: string; cookie: string; paste: string }> = {};
  for (const p of PERSONAS) {
    const token = crypto.randomUUID().replaceAll("-", "");
    db.insert(s.session)
      .values({
        id: `mock-session-${p.id}`,
        token,
        userId: p.id,
        expiresAt: new Date(NOW + 7 * DAY),
        userAgent: "mock-seed",
      })
      .run();
    const cookie = await signed(token, secret);
    // Ready to paste into the browser console on localhost:3001.
    const paste = `document.cookie = "better-auth.session_token=${cookie}; path=/"; location.href = "/staff/dashboard";`;
    out[p.id] = { note: p.note, cookie, paste };
  }
  const target = resolve(dirname(file), "../../mock-sessions.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify({ cookieName: "better-auth.session_token", personas: out }, null, 2)}\n`,
  );
  sessionNote = `Session cookies: ${target}`;
} catch (error) {
  sessionNote = `No session cookies (${(error as Error).message}); use the admin's "ดูในมุมมองของ…" instead.`;
}

const count = (rows: unknown[]) => rows.length;
console.log(
  [
    `Seeded ${file}`,
    `  accounts ${count(accounts)} · registrations ${count(registrations)} · teams ${count(teams)} · matches ${count(matches)} · score events ${count(events)}`,
    `  ${sessionNote}`,
  ].join("\n"),
);
