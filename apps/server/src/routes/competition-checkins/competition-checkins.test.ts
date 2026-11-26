import { beforeEach, describe, expect, test } from "bun:test";
import {
  competitionChange,
  competitionLineup,
  competitionMatch,
  competitionMatchCheckin,
  competitionMatchParticipant,
  competitionTeamMember,
  sportDivision,
  sportRegistration,
  venue,
} from "@it3k/db/schema/index";
import type { Institution } from "@it3k/db/profile";
import { eq } from "drizzle-orm";

import { seedMatch } from "../../competition/testing";
import { createTestContext, defined, readJson } from "../../testing";
import { createCompetitionCheckinRoutes } from ".";
import { checkinWindow, minPlayers, sideLabel } from "./rules";

const MIN = 60_000;
// 10:00 in Bangkok.
const NOW = Date.UTC(2026, 11, 5, 3, 0);
// Kicks off at 10:40, so check-in runs 10:00 to 10:30.
const START = NOW + 40 * MIN;

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCompetitionCheckinRoutes>;
let clock: number;
let venueId: string;
let match: { id: string; divisionId: string; home: string; away: string };

async function addAthlete(
  userId: string,
  teamId: string,
  divisionId: string,
  institution: Institution,
  shirtNumber: number,
) {
  await t.seedParticipant(userId, institution);
  const [registration] = await t.db
    .insert(sportRegistration)
    .values({ userId, divisionId, institution, status: "approved", shirtNumber })
    .returning();
  const registrationId = defined(registration).id;
  await t.db.insert(competitionTeamMember).values({
    teamId,
    registrationId,
    userId,
    displayName: `ชื่อ-${userId}`,
    sortOrder: shirtNumber,
  });
  return registrationId;
}

beforeEach(async () => {
  t = createTestContext();
  clock = NOW;
  app = createCompetitionCheckinRoutes({ ...t.deps, now: () => clock });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("reg", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("sports-staff", { department: "กีฬา", institution: "kmitl" });
  await t.seedUser("athlete", { role: "athlete" });

  const [field] = await t.db.insert(venue).values({ name: "สนามฟุตบอล" }).returning();
  venueId = defined(field).id;
  const seeded = await seedMatch(t);
  await t.db
    .update(competitionMatch)
    .set({ venueId, startAt: new Date(START) })
    .where(eq(competitionMatch.id, seeded.match.id));
  // Two players are enough to play in these tests.
  await t.db
    .update(sportDivision)
    .set({ checkinMinPlayers: 2 })
    .where(eq(sportDivision.id, seeded.divisionId));
  const [home, away] = seeded.sides;
  match = {
    id: seeded.match.id,
    divisionId: seeded.divisionId,
    home: defined(home).id,
    away: defined(away).id,
  };
  const homeTeam = defined(defined(home).teamId);
  const awayTeam = defined(defined(away).teamId);
  await addAthlete("p1", homeTeam, seeded.divisionId, "kmitl", 7);
  await addAthlete("p2", homeTeam, seeded.divisionId, "kmitl", 9);
  await addAthlete("p3", awayTeam, seeded.divisionId, "kmutt", 10);
  await t.seedParticipant("outsider", "kmitl");
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

const scan = (code: string, who = "tech") => send(who, "POST", `/venues/${venueId}/scan`, { code });

const checkins = () => t.db.select().from(competitionMatchCheckin);

describe("rules", () => {
  test("the window includes both edges", () => {
    const division = { checkinOpensMin: 40, checkinClosesMin: 10 };
    expect(checkinWindow(START, division, START - 40 * MIN - 1).state).toBe("early");
    expect(checkinWindow(START, division, START - 40 * MIN).state).toBe("open");
    expect(checkinWindow(START, division, START - 10 * MIN).state).toBe("open");
    expect(checkinWindow(START, division, START - 10 * MIN + 1).state).toBe("closed");
  });

  test("the minimum falls back to the lineup, then the team size", () => {
    expect(minPlayers({ checkinMinPlayers: 3, lineupStarters: 11, teamMinSize: 7 })).toBe(3);
    expect(minPlayers({ checkinMinPlayers: null, lineupStarters: 11, teamMinSize: 7 })).toBe(11);
    expect(minPlayers({ checkinMinPlayers: null, lineupStarters: null, teamMinSize: 7 })).toBe(7);
    expect(minPlayers({ checkinMinPlayers: null, lineupStarters: null, teamMinSize: null })).toBe(
      1,
    );
  });

  test("sides are named by team, institution or placeholder", () => {
    const base = { label: null, teamName: null, institution: null, seq: null };
    expect(sideLabel({ ...base, institution: "kmitl", seq: 1 })).toBe("สจล.");
    expect(sideLabel({ ...base, institution: "kmitl", seq: 2 })).toBe("สจล. 2");
    expect(sideLabel({ ...base, teamName: "ทีมเสือ", institution: "kmitl", seq: 1 })).toBe("ทีมเสือ");
    expect(sideLabel({ ...base, label: "ผู้ชนะ M3" })).toBe("ผู้ชนะ M3");
  });
});

describe("scanning at the venue", () => {
  test("checks a team member in for their match and counts the side", async () => {
    const { res, body } = await scan("p1");
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      code: "checked-in",
      person: { userId: "p1", name: "ชื่อ-p1", shirtNumber: 7, institution: "kmitl" },
      match: { id: match.id },
      side: { participantId: match.home, label: "สจล.", checkedIn: 1, min: 2 },
    });
    const rows = await checkins();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "scan", checkedInBy: "tech", userId: "p1" });
  });

  test("a second scan is idempotent", async () => {
    const first = await scan("p1");
    clock = NOW + 5 * MIN;
    const again = await scan("  p1 ");
    expect(again.res.status).toBe(200);
    expect(again.body).toMatchObject({
      code: "duplicate",
      checkedInAt: first.body.checkedInAt,
      side: { checkedIn: 1 },
    });
    expect(await checkins()).toHaveLength(1);
  });

  test("opens 40 minutes before the start and closes 10 minutes before", async () => {
    clock = START - 40 * MIN - 1;
    const early = await scan("p1");
    expect(early.res.status).toBe(409);
    expect(early.body).toMatchObject({
      code: "too-early",
      opensAt: new Date(START - 40 * MIN).toISOString(),
      person: { userId: "p1" },
    });

    clock = START - 10 * MIN + 1;
    const late = await scan("p1");
    expect(late.res.status).toBe(409);
    expect(late.body.code).toBe("closed");
    expect(await checkins()).toHaveLength(0);

    clock = START - 40 * MIN;
    expect((await scan("p1")).res.status).toBe(201);
    clock = START - 10 * MIN;
    expect((await scan("p2")).res.status).toBe(201);
  });

  test("a side with a lineup takes only its players; one without takes its team", async () => {
    const [registration] = await t.db
      .select({ id: sportRegistration.id })
      .from(sportRegistration)
      .where(eq(sportRegistration.userId, "p1"));
    await t.db.insert(competitionLineup).values({
      participantId: match.home,
      matchId: match.id,
      registrationId: defined(registration).id,
      role: "starter",
    });

    const benched = await scan("p2");
    expect(benched.res.status).toBe(409);
    expect(benched.body).toMatchObject({ code: "not-in-lineup", match: { id: match.id } });

    expect((await scan("p1")).res.status).toBe(201);
    const away = await scan("p3");
    expect(away.res.status).toBe(201);
    expect(away.body).toMatchObject({ side: { participantId: match.away, label: "มจธ." } });
  });

  test("refuses event ticket QR codes and unknown barcodes", async () => {
    const ticket = await scan("it3k-t:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(ticket.res.status).toBe(400);
    expect(ticket.body.code).toBe("ticket");
    expect(String(ticket.body.message)).toContain("QR ตั๋ว");

    const unknown = await scan("nobody");
    expect(unknown.res.status).toBe(404);
    expect(unknown.body.code).toBe("unknown");

    const outsider = await scan("outsider");
    expect(outsider.res.status).toBe(404);
    expect(outsider.body.code).toBe("no-match");
    expect(await checkins()).toHaveLength(0);
  });

  test("ignores matches at other venues, started ones and manual divisions", async () => {
    const [other] = await t.db.insert(venue).values({ name: "โรงยิม" }).returning();
    await t.db
      .update(competitionMatch)
      .set({ venueId: defined(other).id })
      .where(eq(competitionMatch.id, match.id));
    expect((await scan("p1")).body.code).toBe("no-match");

    await t.db
      .update(competitionMatch)
      .set({ venueId, status: "live" })
      .where(eq(competitionMatch.id, match.id));
    expect((await scan("p1")).body.code).toBe("no-match");

    await t.db
      .update(competitionMatch)
      .set({ status: "checkin" })
      .where(eq(competitionMatch.id, match.id));
    await t.db
      .update(sportDivision)
      .set({ checkinMode: "manual" })
      .where(eq(sportDivision.id, match.divisionId));
    expect((await scan("p1")).body.code).toBe("no-match");
  });

  test("checks in to the next open match when two are at the venue", async () => {
    const [second] = await t.db
      .insert(competitionMatch)
      .values({
        divisionId: match.divisionId,
        stageName: "รอบแบ่งกลุ่ม",
        venueId,
        startAt: new Date(START + 15 * MIN),
      })
      .returning();
    const secondId = defined(second).id;
    await t.db.insert(competitionMatchParticipant).values([
      { matchId: secondId, teamId: defined(await teamOf(match.home)), slot: 1 },
      { matchId: secondId, teamId: defined(await teamOf(match.away)), slot: 2 },
    ]);
    clock = START - 20 * MIN;
    expect((await scan("p1")).body).toMatchObject({ match: { id: match.id } });
    // Once the first has closed, the second is next.
    clock = START - 5 * MIN;
    expect((await scan("p1")).body).toMatchObject({ code: "checked-in", match: { id: secondId } });
  });

  test("needs the match check-in permission", async () => {
    expect((await scan("p1", "sports-staff")).res.status).toBe(403);
    expect((await scan("p1", "athlete")).res.status).toBe(403);
    expect((await scan("p1", "reg")).res.status).toBe(201);
  });
});

describe("reading check-in state", () => {
  test("a venue shows its open matches with counts per side", async () => {
    await scan("p1");
    const { res, body } = await send("tech", "GET", `/venues/${venueId}`);
    expect(res.status).toBe(200);
    const matches = body.matches as {
      id: string;
      minPlayers: number;
      window: { state: string };
      sides: { label: string; checkedIn: number; expected: number }[];
    }[];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: match.id, minPlayers: 2, window: { state: "open" } });
    expect(matches[0]?.sides.map((s) => [s.label, s.checkedIn, s.expected])).toEqual([
      ["สจล.", 1, 2],
      ["มจธ.", 0, 1],
    ]);
    expect(body.next).toBeNull();

    clock = START - 60 * MIN;
    const before = await send("tech", "GET", `/venues/${venueId}`);
    expect(before.body.matches).toEqual([]);
    expect(before.body.next).toMatchObject({ id: match.id, window: { state: "early" } });

    expect((await send("tech", "GET", "/venues/nope")).res.status).toBe(404);
  });

  test("a match lists each side's roster with ticks", async () => {
    await scan("p1");
    const { res, body } = await send("tech", "GET", `/matches/${match.id}`);
    expect(res.status).toBe(200);
    const detail = body.match as {
      sides: { roster: { userId: string; shirtNumber: number; checkin: unknown }[] }[];
    };
    const home = defined(detail.sides[0]);
    expect(home.roster.map((r) => [r.userId, r.shirtNumber, r.checkin !== null])).toEqual([
      ["p1", 7, true],
      ["p2", 9, false],
    ]);
    expect(body).toMatchObject({ canCheckIn: true, canForfeit: false });
  });

  test("the staff list covers matches around now, with venues", async () => {
    const { body } = await send("tech", "GET", "/");
    expect((body.items as { id: string }[]).map((m) => m.id)).toEqual([match.id]);
    expect(body.venues).toEqual([{ id: venueId, name: "สนามฟุตบอล" }]);
    expect(body.canForfeit).toBe(true);
    const elsewhere = await send("tech", "GET", "/?venueId=other");
    expect(elsewhere.body.items).toEqual([]);
  });
});

describe("manual check-in", () => {
  const path = () => `/matches/${match.id}/checkins`;

  test("staff tick an athlete in and out, and both are audited", async () => {
    const ticked = await send("tech", "POST", path(), { participantId: match.home, userId: "p2" });
    expect(ticked.res.status).toBe(201);
    expect(ticked.body).toMatchObject({ method: "manual", checkedIn: 1, duplicate: false });

    const again = await send("tech", "POST", path(), { participantId: match.home, userId: "p2" });
    expect(again.res.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(await checkins()).toHaveLength(1);

    const undone = await send("tech", "DELETE", `${path()}/p2`);
    expect(undone.res.status).toBe(200);
    expect(undone.body).toMatchObject({ participantId: match.home, checkedIn: 0 });
    expect(await checkins()).toHaveLength(0);
    expect((await send("tech", "DELETE", `${path()}/p2`)).res.status).toBe(404);

    const audit = await t.db.select().from(competitionChange);
    expect(audit.map((row) => [row.entity, row.action])).toEqual([
      ["checkin", "checkin"],
      ["checkin", "undo"],
    ]);
  });

  test("works outside the window, but only for the athlete's own side", async () => {
    clock = START + 5 * MIN;
    const wrong = await send("tech", "POST", path(), { participantId: match.away, userId: "p1" });
    expect(wrong.res.status).toBe(400);
    const stranger = await send("tech", "POST", path(), {
      participantId: match.home,
      userId: "outsider",
    });
    expect(stranger.res.status).toBe(400);
    const late = await send("tech", "POST", path(), { participantId: match.home, userId: "p1" });
    expect(late.res.status).toBe(201);
  });

  test("a finished match takes no more check-ins", async () => {
    await t.db
      .update(competitionMatch)
      .set({ status: "finished" })
      .where(eq(competitionMatch.id, match.id));
    const res = await send("tech", "POST", path(), { participantId: match.home, userId: "p1" });
    expect(res.res.status).toBe(409);
    expect((await send("tech", "DELETE", `${path()}/p1`)).res.status).toBe(409);
  });

  test("score keepers without check-in rights are refused", async () => {
    const res = await send("sports-staff", "POST", path(), {
      participantId: match.home,
      userId: "p1",
    });
    expect(res.res.status).toBe(403);
  });
});

describe("forfeit", () => {
  const path = () => `/matches/${match.id}/forfeit`;
  const closed = START - 10 * MIN + 1;

  async function checkInHome() {
    await scan("p1");
    await scan("p2");
  }

  test("a side short of the minimum loses once check-in has closed", async () => {
    await checkInHome();
    expect(
      (await send("tech", "POST", path(), { participantIds: [match.away], version: 1 })).res.status,
    ).toBe(409);

    clock = closed;
    const detail = await send("tech", "GET", `/matches/${match.id}`);
    expect(detail.body.canForfeit).toBe(true);

    const full = await send("tech", "POST", path(), { participantIds: [match.home], version: 1 });
    expect(full.res.status).toBe(409);

    const { res, body } = await send("reg", "POST", path(), {
      participantIds: [match.away],
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "finished", outcome: "forfeit", version: 2 });
    expect(body.sides).toEqual([
      { participantId: match.home, outcome: "walkover_win", rank: 1 },
      { participantId: match.away, outcome: "forfeit", rank: 2 },
    ]);
    const [saved] = await t.db
      .select()
      .from(competitionMatch)
      .where(eq(competitionMatch.id, match.id));
    expect(saved?.finishedAt?.getTime()).toBe(closed);
    const audit = await t.db.select().from(competitionChange);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entity: "match", action: "forfeit", actorUserId: "reg" });

    const again = await send("tech", "POST", path(), { participantIds: [match.away], version: 2 });
    expect(again.res.status).toBe(409);
  });

  test("both sides may forfeit, leaving no winner", async () => {
    clock = closed;
    const { res, body } = await send("tech", "POST", path(), {
      participantIds: [match.home, match.away],
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(body.sides).toEqual([
      { participantId: match.home, outcome: "forfeit", rank: null },
      { participantId: match.away, outcome: "forfeit", rank: null },
    ]);
  });

  test("a stale version or a late check-in in between is refused", async () => {
    clock = closed;
    const stale = await send("tech", "POST", path(), { participantIds: [match.away], version: 0 });
    expect(stale.res.status).toBe(409);

    // p3 and a teammate are ticked in while the forfeit is on its way.
    await addAthlete("p4", defined(await teamOf(match.away)), match.divisionId, "kmutt", 11);
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into competition_match_checkin (id, match_id, participant_id, user_id, method)
         values ('x3', '${match.id}', '${match.away}', 'p3', 'manual'),
                ('x4', '${match.id}', '${match.away}', 'p4', 'manual')`,
      );
    };
    const raced = await send("tech", "POST", path(), { participantIds: [match.away], version: 1 });
    expect(raced.res.status).toBe(409);
    const [saved] = await t.db
      .select()
      .from(competitionMatch)
      .where(eq(competitionMatch.id, match.id));
    expect(saved?.status).toBe("scheduled");
    expect(await t.db.select().from(competitionChange)).toHaveLength(0);
  });

  test("needs score or manage rights as well as check-in", async () => {
    clock = closed;
    const res = await send("sports-staff", "POST", path(), {
      participantIds: [match.away],
      version: 1,
    });
    expect(res.res.status).toBe(403);
    const bad = await send("tech", "POST", path(), { participantIds: ["nope"], version: 1 });
    expect(bad.res.status).toBe(400);
  });
});

async function teamOf(participantId: string) {
  const [row] = await t.db
    .select({ teamId: competitionTeamMember.teamId })
    .from(competitionTeamMember)
    .innerJoin(sportRegistration, eq(sportRegistration.id, competitionTeamMember.registrationId))
    .where(eq(sportRegistration.userId, participantId === match.away ? "p3" : "p1"));
  return row?.teamId;
}
