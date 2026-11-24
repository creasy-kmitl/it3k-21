import { beforeEach, describe, expect, test } from "bun:test";
import { competitionChange, sportDivision } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createCompetitionDivisionRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCompetitionDivisionRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createCompetitionDivisionRoutes(t.deps);
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("sports-head", { department: "กีฬา", seat: "head", institution: "kmitl" });
  await t.seedUser("sports-staff", { department: "กีฬา", institution: "kmitl" });
  await t.seedUser("reg-kmutt", { department: "ทะเบียน", institution: "kmutt" });
  await t.seedUser("athlete", { role: "athlete" });
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

async function divisionId(code: string) {
  const [row] = await t.db
    .select({ id: sportDivision.id })
    .from(sportDivision)
    .where(eq(sportDivision.code, code));
  return defined(row).id;
}

type Settings = Record<string, unknown> & { version: number; scoringConfig: { engine: string } };

const settingsBody = (division: Settings) => ({
  maxTeamsPerInstitution: division.maxTeamsPerInstitution,
  teamMinSize: division.teamMinSize,
  teamMaxSize: division.teamMaxSize,
  genderMinimums: division.genderMinimums,
  maxOfficials: division.maxOfficials,
  lineupStarters: division.lineupStarters,
  lineupMaxSubs: division.lineupMaxSubs,
  scoringConfig: division.scoringIsDefault ? null : division.scoringConfig,
  standingsConfig: division.standingsConfig,
  checkinMode: division.checkinMode,
  checkinOpensMin: division.checkinOpensMin,
  checkinClosesMin: division.checkinClosesMin,
  checkinMinPlayers: division.checkinMinPlayers,
  awardsMedals: division.awardsMedals,
  version: division.version,
});

describe("reading", () => {
  test("competition readers see every division's settings, with counts", async () => {
    const { res, body } = await send("sports-staff", "GET", "/");
    expect(res.status).toBe(200);
    const items = body.items as (Settings & { code: string; teamCount: number })[];
    const football = defined(items.find((item) => item.code === "football"));
    expect(football).toMatchObject({ teamMinSize: 11, teamMaxSize: 25, teamCount: 0 });
    expect(football.scoringConfig.engine).toBe("points");
    expect(body.canManage).toBe(false);
  });

  test("athletes and other institutions' registration staff are refused", async () => {
    for (const who of ["athlete", "reg-kmutt"]) {
      expect((await send(who, "GET", "/")).res.status).toBe(403);
    }
  });
});

describe("saving", () => {
  test("match managers change a division's settings, one version at a time", async () => {
    const id = await divisionId("basketball-3x3-female");
    const { body } = await send("sports-head", "GET", `/${id}`);
    expect(body.canManage).toBe(true);
    const division = body.division as Settings;
    const final = { ...division.scoringConfig, targetScore: 21, targetWinBy: 2 };

    const saved = await send("sports-head", "PUT", `/${id}`, {
      ...settingsBody(division),
      scoringConfig: final,
      checkinMode: "manual",
    });
    expect(saved.res.status).toBe(200);
    expect(saved.body.division).toMatchObject({
      version: 2,
      checkinMode: "manual",
      scoringConfig: final,
      scoringIsDefault: false,
    });
    const audit = await t.db.select().from(competitionChange);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entity: "division",
      entityId: id,
      actorUserId: "sports-head",
    });

    // A second editor still on version 1 is refused, and nothing is logged.
    const stale = await send("tech", "PUT", `/${id}`, settingsBody(division));
    expect(stale.res.status).toBe(409);
    expect(await t.db.select().from(competitionChange)).toHaveLength(1);
  });

  test("score keepers may read but not change settings", async () => {
    const id = await divisionId("football");
    const division = (await send("sports-staff", "GET", `/${id}`)).body.division as Settings;
    const { res } = await send("sports-staff", "PUT", `/${id}`, settingsBody(division));
    expect(res.status).toBe(403);
  });

  test("bad settings are refused", async () => {
    const id = await divisionId("football");
    const division = (await send("tech", "GET", `/${id}`)).body.division as Settings;
    const { res } = await send("tech", "PUT", `/${id}`, {
      ...settingsBody(division),
      teamMinSize: 30,
    });
    expect(res.status).toBe(400);
    expect((await send("tech", "PUT", "/nope", settingsBody(division))).res.status).toBe(404);
  });
});
