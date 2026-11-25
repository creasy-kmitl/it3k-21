import { beforeEach, describe, expect, test } from "bun:test";
import {
  competitionGroup,
  competitionGroupTeam,
  competitionLineup,
  competitionMatch,
  competitionMatchImage,
  competitionMatchParticipant,
  competitionMatchReferee,
  competitionPlacement,
  competitionTeam,
  competitionTeamMember,
  competitionTeamOfficial,
  sportDivision,
  sportRegistration,
  sportRule,
  venue,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createPublicCompetitionRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createPublicCompetitionRoutes>;

const HOUR = 60 * 60 * 1000;
// 25 Dec 2026, 10:00 in Bangkok.
const MORNING = Date.UTC(2026, 11, 25, 3);

type Json = Record<string, unknown>;
type Side = Json & { name: string; score: number | null; members: Json[]; officials: Json[] };
type Match = Json & { id: string; status: string; sides: Side[] };

async function get<T = Json>(path: string) {
  // No session at all: public pages are read signed out.
  const res = await app.request(path);
  return { res, body: (await readJson(res)) as T };
}

async function divisionId(code: string) {
  const [row] = await t.db
    .select({ id: sportDivision.id, sportId: sportDivision.sportId })
    .from(sportDivision)
    .where(eq(sportDivision.code, code));
  return defined(row);
}

async function team(division: string, institution: "kmitl" | "kmutt" | "kmutnb-bangkok", seq = 1) {
  const [row] = await t.db
    .insert(competitionTeam)
    .values({ divisionId: division, institution, seq })
    .returning();
  return defined(row).id;
}

async function match(
  division: string,
  teams: string[],
  values: Partial<typeof competitionMatch.$inferInsert> = {},
  results: Partial<typeof competitionMatchParticipant.$inferInsert>[] = [],
) {
  const [row] = await t.db
    .insert(competitionMatch)
    .values({ divisionId: division, stageName: "รอบแบ่งกลุ่ม", ...values })
    .returning();
  const id = defined(row).id;
  const sides = await t.db
    .insert(competitionMatchParticipant)
    .values(
      teams.map((teamId, index) => ({ matchId: id, teamId, slot: index + 1, ...results[index] })),
    )
    .returning();
  return { id, sides };
}

/** An athlete with an approved registration, on `teamId`. */
async function athlete(
  userId: string,
  division: string,
  teamId: string,
  institution: "kmitl" | "kmutt",
  shirtNumber: number,
  displayName: string,
) {
  await t.seedUser(userId, { role: "athlete", name: `นาย ${userId} นามสกุลลับ`, institution });
  const [registration] = await t.db
    .insert(sportRegistration)
    .values({ userId, divisionId: division, institution, status: "approved", shirtNumber })
    .returning();
  const registrationId = defined(registration).id;
  await t.db.insert(competitionTeamMember).values({
    teamId,
    registrationId,
    userId,
    displayName,
    sortOrder: shirtNumber,
  });
  return registrationId;
}

/** Replaces the seeded rules of a sport or a division. */
async function setRules(rule: { sportId?: string; divisionId?: string; markdown: string }) {
  await t.db
    .delete(sportRule)
    .where(
      rule.sportId
        ? eq(sportRule.sportId, rule.sportId)
        : eq(sportRule.divisionId, rule.divisionId ?? ""),
    );
  await t.db.insert(sportRule).values(rule);
}

beforeEach(() => {
  t = createTestContext();
  app = createPublicCompetitionRoutes(t.deps);
});

describe("match list", () => {
  test("lists whole matches signed out, soonest first, with sides and scoring", async () => {
    const football = await divisionId("football");
    const kmitl = await team(football.id, "kmitl");
    const kmutt = await team(football.id, "kmutt");
    await t.db.insert(venue).values({ id: "v-field", name: "สนามฟุตบอล" });
    const later = await match(football.id, [kmitl, kmutt], {
      startAt: new Date(MORNING + 2 * HOUR),
      matchNo: 2,
    });
    const first = await match(
      football.id,
      [kmutt, kmitl],
      { startAt: new Date(MORNING), venueId: "v-field", status: "finished", outcome: "played" },
      [
        { score: 2, outcome: "win", rank: 1 },
        { score: 1, outcome: "loss", rank: 2 },
      ],
    );
    // A sub-match never shows on its own.
    await t.db
      .insert(competitionMatch)
      .values({ divisionId: football.id, stageName: "x", parentMatchId: first.id, subOrder: 1 });

    const { res, body } = await get<{ items: Match[] }>("/matches");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=5");
    expect(body.items.map((item) => item.id)).toEqual([first.id, later.id]);
    expect(body.items[0]).toMatchObject({
      status: "finished",
      venue: { id: "v-field", name: "สนามฟุตบอล" },
      division: { code: "football" },
      scoring: { engine: "points" },
      startAt: MORNING,
    });
    expect(body.items[0]?.sides.map((side) => [side.name, side.score, side.outcome])).toEqual([
      ["มจธ.", 2, "win"],
      ["สจล.", 1, "loss"],
    ]);
  });

  test("filters by sport, division, venue, day, status and a search", async () => {
    const football = await divisionId("football");
    const basketball = await divisionId("basketball-5x5-male");
    const [fa, fb] = [await team(football.id, "kmitl"), await team(football.id, "kmutt")];
    const [ba, bb] = [
      await team(basketball.id, "kmitl"),
      await team(basketball.id, "kmutnb-bangkok"),
    ];
    await t.db.insert(venue).values([
      { id: "v-field", name: "สนามฟุตบอล" },
      { id: "v-gym", name: "โรงยิม" },
    ]);
    const ball = await match(football.id, [fa, fb], {
      startAt: new Date(MORNING),
      venueId: "v-field",
    });
    const hoops = await match(basketball.id, [ba, bb], {
      // 23:30 in Bangkok on the 25th: still the 25th there, though the 25th UTC too.
      startAt: new Date(Date.UTC(2026, 11, 25, 16, 30)),
      venueId: "v-gym",
      status: "live",
    });
    const nextDay = await match(basketball.id, [bb, ba], {
      // 00:30 on the 26th in Bangkok, still the 25th in UTC.
      startAt: new Date(Date.UTC(2026, 11, 25, 17, 30)),
    });

    const ids = async (query: string) =>
      (await get<{ items: Match[] }>(`/matches?${query}`)).body.items.map((item) => item.id);
    expect(await ids(`sportId=${football.sportId}`)).toEqual([ball.id]);
    expect(await ids(`divisionId=${basketball.id}`)).toEqual([hoops.id, nextDay.id]);
    expect(await ids("venueId=v-gym")).toEqual([hoops.id]);
    expect(await ids("status=live")).toEqual([hoops.id]);
    expect(await ids("day=2026-12-25")).toEqual([ball.id, hoops.id]);
    expect(await ids("day=2026-12-26")).toEqual([nextDay.id]);
    expect(await ids("q=มจพ")).toEqual([hoops.id, nextDay.id]);
    expect(await ids("q=พระนครเหนือ")).toEqual([hoops.id, nextDay.id]);
    expect(await ids("q=ฟุตบอล")).toEqual([ball.id]);
    expect((await get("/matches?status=nope")).res.status).toBe(400);

    const filters = (await get<{ sports: Json[]; venues: Json[]; days: string[] }>("/filters"))
      .body;
    expect(filters.days).toEqual(["2026-12-25", "2026-12-26"]);
    // Thai order skips the leading vowel: โรง sorts under ร, before ส.
    expect(filters.venues.map((v) => v.name)).toEqual(["โรงยิม", "สนามฟุตบอล"]);
    expect(filters.sports).toHaveLength(2);
  });

  test("a second team of an institution is numbered", async () => {
    const singles = await divisionId("badminton-singles-male");
    const one = await team(singles.id, "kmitl", 1);
    const two = await team(singles.id, "kmitl", 2);
    await match(singles.id, [one, two]);
    const { body } = await get<{ items: Match[] }>("/matches");
    expect(body.items[0]?.sides.map((side) => side.name)).toEqual(["สจล. 1", "สจล. 2"]);
  });
});

describe("live board", () => {
  test("live matches, the next ones coming up, and the latest results", async () => {
    const football = await divisionId("football");
    const [a, b] = [await team(football.id, "kmitl"), await team(football.id, "kmutt")];
    const now = Date.now();
    const live = await match(football.id, [a, b], {
      status: "live",
      startAt: new Date(now - HOUR),
      liveState: { period: 2, phase: "regular", decided: false, clock: null, secret: "x" },
    });
    const soon = await match(football.id, [a, b], { startAt: new Date(now + HOUR) });
    const late = await match(football.id, [b, a], {
      status: "checkin",
      startAt: new Date(now - HOUR / 2),
    });
    // Due long ago and never started: not "coming up" any more.
    await match(football.id, [a, b], { startAt: new Date(now - 5 * HOUR) });
    const done = await match(football.id, [a, b], {
      status: "finished",
      finishedAt: new Date(now - HOUR),
    });

    const { body } = await get<{ live: Match[]; upcoming: Match[]; recent: Match[] }>("/live");
    expect(body.live.map((m) => m.id)).toEqual([live.id]);
    expect(body.live[0]?.live).toEqual({
      period: 2,
      phase: "regular",
      decided: false,
      clock: null,
    });
    expect(body.upcoming.map((m) => m.id)).toEqual([late.id, soon.id]);
    expect(body.recent.map((m) => m.id)).toEqual([done.id]);
  });
});

describe("match page", () => {
  test("shows lineups, officials, referees, images, rules and the timeline", async () => {
    const football = await divisionId("football");
    const kmitl = await team(football.id, "kmitl");
    const kmutt = await team(football.id, "kmutt");
    const ten = await athlete("u-ten", football.id, kmitl, "kmitl", 10, "สมชาย");
    const seven = await athlete("u-seven", football.id, kmitl, "kmitl", 7, "สมศักดิ์");
    await athlete("u-bench", football.id, kmitl, "kmitl", 22, "สมปอง");
    await athlete("u-away", football.id, kmutt, "kmutt", 9, "มานะ");
    await t.db.insert(competitionTeamOfficial).values({
      teamId: kmitl,
      name: "โค้ชเอ",
      position: "ผู้ฝึกสอน",
      photoUrl: "https://files.example/coach.png",
    });
    const { id, sides } = await match(football.id, [kmitl, kmutt], {
      status: "live",
      liveState: {
        period: 1,
        phase: "regular",
        decided: false,
        clock: null,
        timeline: [
          {
            eventId: "e1",
            at: MORNING,
            period: 1,
            participantId: "p-home",
            text: "+1",
            registrationId: ten,
          },
        ],
      },
    });
    const home = defined(sides[0]).id;
    await t.db.insert(competitionLineup).values([
      { participantId: home, matchId: id, registrationId: ten, role: "starter" },
      { participantId: home, matchId: id, registrationId: seven, role: "sub" },
    ]);
    await t.db
      .insert(competitionMatchReferee)
      .values({ matchId: id, name: "กรรมการบี", role: "ผู้ตัดสิน" });
    await t.db.insert(competitionMatchImage).values([
      { matchId: id, url: "https://files.example/2.png", sortOrder: 2 },
      { matchId: id, url: "https://files.example/cover.png", isCover: true, sortOrder: 5 },
    ]);
    await setRules({ sportId: football.sportId, markdown: "# กติกากีฬา" });
    await setRules({ divisionId: football.id, markdown: "# กติกาประเภท" });

    const { res, body } = await get<
      Match & { referees: Json[]; images: Json[]; rules: string; timeline: Json[] }
    >(`/matches/${id}`);
    expect(res.status).toBe(200);
    // With a lineup, only the athletes named in it show, starters and subs.
    expect(body.sides[0]?.members).toEqual([
      { name: "สมศักดิ์", shirtNumber: 7, role: "sub" },
      { name: "สมชาย", shirtNumber: 10, role: "starter" },
    ]);
    // Without one, the whole team shows.
    expect(body.sides[1]?.members).toEqual([{ name: "มานะ", shirtNumber: 9, role: null }]);
    expect(body.sides[0]?.officials).toEqual([
      {
        name: "โค้ชเอ",
        position: "ผู้ฝึกสอน",
        description: null,
        photoUrl: "https://files.example/coach.png",
      },
    ]);
    expect(body.referees).toEqual([{ name: "กรรมการบี", role: "ผู้ตัดสิน" }]);
    expect(body.images.map((image) => image.url)).toEqual([
      "https://files.example/cover.png",
      "https://files.example/2.png",
    ]);
    expect(body.rules).toBe("# กติกาประเภท");
    expect(body.timeline).toEqual([
      {
        id: "e1",
        at: MORNING,
        period: 1,
        sideId: "p-home",
        text: "+1",
        athlete: { name: "สมชาย", shirtNumber: 10 },
      },
    ]);

    // Never an email, an account id, a registration id, a surname or a student id.
    const raw = JSON.stringify(body);
    const secrets = ["@example.com", "u-ten", "u-away", ten, seven, "นามสกุลลับ", "userId", "สมปอง"];
    for (const secret of secrets) {
      expect(raw).not.toContain(secret);
    }
  });

  test("falls back to the sport's rules, and 404s an unknown match", async () => {
    const football = await divisionId("football");
    const [a, b] = [await team(football.id, "kmitl"), await team(football.id, "kmutt")];
    const { id } = await match(football.id, [a, b]);
    await setRules({ sportId: football.sportId, markdown: "# กติกากีฬา" });
    const { body } = await get<{ rules: string; timeline: Json[]; subMatches: Json[] }>(
      `/matches/${id}`,
    );
    expect(body).toMatchObject({ rules: "# กติกากีฬา", timeline: [], subMatches: [] });
    expect((await get("/matches/nope")).res.status).toBe(404);
  });
});

describe("standings", () => {
  test("group tables from finished, non-friendly group matches", async () => {
    const football = await divisionId("football");
    const [a, b, c] = [
      await team(football.id, "kmitl"),
      await team(football.id, "kmutt"),
      await team(football.id, "kmutnb-bangkok"),
    ];
    const [group] = await t.db
      .insert(competitionGroup)
      .values({ divisionId: football.id, stageName: "รอบแบ่งกลุ่ม", name: "สาย A" })
      .returning();
    const groupId = defined(group).id;
    await t.db.insert(competitionGroupTeam).values([
      { groupId, teamId: a, seed: 1 },
      { groupId, teamId: b, seed: 2 },
      { groupId, teamId: c, seed: 3 },
    ]);
    const finished = { groupId, status: "finished" as const, outcome: "played" as const };
    await match(football.id, [b, a], finished, [
      { score: 3, outcome: "win" },
      { score: 0, outcome: "loss" },
    ]);
    await match(football.id, [c, a], finished, [
      { score: 1, outcome: "draw" },
      { score: 1, outcome: "draw" },
    ]);
    // A friendly and a live match change nothing.
    await match(football.id, [c, b], { ...finished, friendly: true }, [
      { score: 5, outcome: "win" },
      { score: 0, outcome: "loss" },
    ]);
    await match(football.id, [c, b], { groupId, status: "live" }, [{ score: 9 }, { score: 0 }]);

    const { body } = await get<{
      divisions: (Json & { groups: (Json & { rows: (Json & { team: Json })[] })[] })[];
    }>("/standings");
    expect(body.divisions).toHaveLength(1);
    expect(body.divisions[0]).toMatchObject({
      name: "ฟุตบอล",
      points: { win: 3, draw: 1, loss: 0, forfeit: 0 },
    });
    const rows = defined(body.divisions[0]?.groups[0]).rows;
    expect(rows.map((row) => [row.team.name, row.played, row.points, row.rank])).toEqual([
      ["มจธ.", 1, 3, 1],
      ["มจพ. กรุงเทพฯ", 1, 1, 2],
      ["สจล.", 2, 1, 3],
    ]);

    const other = await divisionId("basketball-5x5-male");
    expect(
      (await get<{ divisions: Json[] }>(`/standings?divisionId=${other.id}`)).body.divisions,
    ).toEqual([]);
  });
});

describe("medals", () => {
  test("adds up places across divisions, skipping friendlies", async () => {
    const football = await divisionId("football");
    const chairball = await divisionId("chairball-male");
    const ft = [
      await team(football.id, "kmutt"),
      await team(football.id, "kmitl"),
      await team(football.id, "kmutnb-bangkok"),
    ];
    // Two teams only: a friendly, so its places earn nothing.
    const ch = [await team(chairball.id, "kmitl"), await team(chairball.id, "kmutt")];
    await t.db
      .insert(competitionPlacement)
      .values([
        ...ft.map((teamId, index) => ({ teamId, divisionId: football.id, place: index + 1 })),
        ...ch.map((teamId, index) => ({ teamId, divisionId: chairball.id, place: index + 1 })),
      ]);

    const { body } = await get<{ rows: Json[]; divisions: (Json & { places: Json[] })[] }>(
      "/medals",
    );
    expect(body.rows.slice(0, 3).map((row) => [row.institution, row.gold, row.points])).toEqual([
      ["kmutt", 1, 4],
      ["kmitl", 0, 3],
      ["kmutnb-bangkok", 0, 2],
    ]);
    expect(body.rows).toHaveLength(4);
    expect(body.divisions.map((d) => [d.name, d.counted, d.places.length])).toEqual([
      ["ฟุตบอล", true, 3],
      ["แชร์บอล ทีมชาย", false, 2],
    ]);
  });
});
