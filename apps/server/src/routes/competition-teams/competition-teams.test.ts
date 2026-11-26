import { beforeEach, describe, expect, test } from "bun:test";
import type { Institution } from "@it3k/db/profile";
import {
  competitionChange,
  competitionLineup,
  competitionMatch,
  competitionTeam,
  competitionTeamMember,
  sportDivision,
  sportRegistration,
  userProfile,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { seedMatch } from "../../competition/testing";
import { createTestContext, defined, readJson } from "../../testing";
import { createCompetitionTeamRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCompetitionTeamRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createCompetitionTeamRoutes(t.deps);
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("sports-head", { department: "กีฬา", seat: "head", institution: "kmitl" });
  await t.seedUser("sports-staff", { department: "กีฬา", institution: "kmitl" });
  await t.seedUser("reg-kmitl", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("athlete", { role: "athlete" });
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

type Team = {
  id: string;
  seq: number;
  version: number;
  label: string;
  members: { registrationId: string; displayName: string; gender: string | null }[];
  officials: { id: string; name: string; photoUrl: string | null }[];
  issues: { code: string; message: string }[];
};

/** An approved (by default) registration of a fresh participant. */
async function register(
  id: string,
  code: string,
  institution: Institution = "kmutt",
  options: {
    status?: "review" | "approved" | "rejected";
    prefix?: string;
    rank?: number;
    shirt?: number;
  } = {},
) {
  await t.seedParticipant(id, institution);
  if (options.prefix) {
    const [profile] = await t.db.select().from(userProfile).where(eq(userProfile.userId, id));
    await t.db
      .update(userProfile)
      .set({ values: { ...defined(profile?.values), prefix: options.prefix as "นาย" } })
      .where(eq(userProfile.userId, id));
  }
  const [row] = await t.db
    .insert(sportRegistration)
    .values({
      userId: id,
      divisionId: await t.divisionId(code),
      institution,
      status: options.status ?? "approved",
      badmintonRank: options.rank ?? null,
      shirtNumber: options.shirt ?? null,
    })
    .returning();
  return defined(row).id;
}

async function createTeam(
  code: string,
  institution: Institution = "kmutt",
  seq: number | null = null,
) {
  const created = await send("tech", "POST", "/", {
    divisionId: await t.divisionId(code),
    institution,
    seq,
    name: null,
  });
  return created;
}

const audit = () => t.db.select().from(competitionChange);

describe("creating teams", () => {
  test("team managers create teams, numbered from the next free seq and audited", async () => {
    const { res, body } = await createTeam("badminton-singles-male");
    expect(res.status).toBe(201);
    expect(body.team).toMatchObject({ seq: 1, label: "มจธ. ทีม 1", institution: "kmutt" });
    expect((body.team as Team).issues.map((issue) => issue.code)).toEqual(["tooFew"]);
    const second = await createTeam("badminton-singles-male");
    expect((second.body.team as Team).seq).toBe(2);
    expect(await audit()).toHaveLength(2);
    expect((await audit())[0]).toMatchObject({
      entity: "team",
      action: "create",
      actorUserId: "tech",
    });
  });

  test("refuses more teams than the division allows per institution", async () => {
    expect((await createTeam("football")).res.status).toBe(201);
    const extra = await createTeam("football");
    expect(extra.res.status).toBe(409);
    expect(extra.body.message).toBe("ประเภทนี้ส่งได้มหาลัยละไม่เกิน 1 ทีม");
    // Another institution still may.
    expect((await createTeam("football", "kmitl")).res.status).toBe(201);
  });

  test("the cap is read again in the batch, so a racing create is refused", async () => {
    const divisionId = await t.divisionId("football");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into competition_team (id, division_id, institution, seq) values ('racer', '${divisionId}', 'kmutt', 5)`,
      );
    };
    const { res } = await createTeam("football");
    expect(res.status).toBe(409);
    expect(await t.db.select().from(competitionTeam)).toHaveLength(1);
    expect(await audit()).toHaveLength(0);
  });

  test("a seq already taken is refused", async () => {
    await createTeam("badminton-singles-male", "kmutt", 2);
    const { res, body } = await createTeam("badminton-singles-male", "kmutt", 2);
    expect(res.status).toBe(409);
    expect(body.message).toBe("มีทีมหมายเลข 2 แล้ว");
  });

  test("score keepers, registration staff and athletes may not create teams", async () => {
    const divisionId = await t.divisionId("football");
    for (const who of ["sports-staff", "reg-kmitl"]) {
      const { res } = await send(who, "POST", "/", {
        divisionId,
        institution: "kmutt",
        seq: null,
        name: null,
      });
      expect(res.status).toBe(403);
    }
    expect((await send("athlete", "GET", "/")).res.status).toBe(403);
  });

  test("sports leaders manage teams", async () => {
    const divisionId = await t.divisionId("football");
    const { res } = await send("sports-head", "POST", "/", {
      divisionId,
      institution: "kmitl",
      seq: null,
      name: "สิงห์ลาดกระบัง",
    });
    expect(res.status).toBe(201);
  });
});

describe("renaming and deleting", () => {
  test("renames at the version read; an older version is stale", async () => {
    const team = (await createTeam("football")).body.team as Team;
    const renamed = await send("tech", "PATCH", `/${team.id}`, { name: "เสือเหลือง", version: 1 });
    expect(renamed.res.status).toBe(200);
    expect(renamed.body.team).toMatchObject({ label: "เสือเหลือง", version: 2 });
    const stale = await send("tech", "PATCH", `/${team.id}`, { name: "x", version: 1 });
    expect(stale.res.status).toBe(409);
  });

  test("deletes a team with no matches, and refuses one that has played", async () => {
    const team = (await createTeam("football", "kmitl")).body.team as Team;
    expect((await send("tech", "DELETE", `/${team.id}`)).res.status).toBe(200);
    expect(await t.db.select().from(competitionTeam)).toHaveLength(0);

    const { sides } = await seedMatch(t);
    const playing = defined(sides[0]?.teamId);
    const refused = await send("tech", "DELETE", `/${playing}`);
    expect(refused.res.status).toBe(409);
    expect(refused.body.message).toBe("ทีมนี้มีแมตช์แล้ว ลบไม่ได้");
  });
});

describe("members", () => {
  test("replaces the member list with approved athletes, copying their first name", async () => {
    const a = await register("a", "football", "kmutt", { prefix: "นาย" });
    const b = await register("b", "football");
    const team = (await createTeam("football")).body.team as Team;
    const saved = await send("tech", "PUT", `/${team.id}/members`, {
      registrationIds: [a, b],
      version: 1,
    });
    expect(saved.res.status).toBe(200);
    const result = saved.body.team as Team;
    expect(result.version).toBe(2);
    expect(result.members.map((member) => member.displayName)).toEqual(["สมชาย", "สมชาย"]);
    expect(result.members[0]?.gender).toBe("male");
    expect(result.issues[0]).toMatchObject({ code: "tooFew" });
    const [row] = await t.db
      .select()
      .from(competitionTeamMember)
      .where(eq(competitionTeamMember.registrationId, a));
    expect(row?.userId).toBe("a");

    // An editor still on version 1 is refused.
    const stale = await send("tech", "PUT", `/${team.id}/members`, {
      registrationIds: [a],
      version: 1,
    });
    expect(stale.res.status).toBe(409);
    expect((await audit()).filter((row) => row.action === "members")).toHaveLength(1);
  });

  test("refuses registrations that are not approved, of another institution or division", async () => {
    const review = await register("r", "football", "kmutt", { status: "review" });
    const other = await register("o", "football", "kmitl");
    const otherDivision = await register("d", "chairball-male", "kmutt");
    const team = (await createTeam("football")).body.team as Team;
    for (const id of [review, other, otherDivision]) {
      const { res } = await send("tech", "PUT", `/${team.id}/members`, {
        registrationIds: [id],
        version: 1,
      });
      expect(res.status).toBe(400);
    }
    const dup = await send("tech", "PUT", `/${team.id}/members`, {
      registrationIds: [other, other],
      version: 1,
    });
    expect(dup.res.status).toBe(400);
  });

  test("a registration plays for one team only", async () => {
    const a = await register("a", "badminton-singles-male");
    const one = (await createTeam("badminton-singles-male")).body.team as Team;
    const two = (await createTeam("badminton-singles-male")).body.team as Team;
    await send("tech", "PUT", `/${one.id}/members`, { registrationIds: [a], version: 1 });
    const { res, body } = await send("tech", "PUT", `/${two.id}/members`, {
      registrationIds: [a],
      version: 1,
    });
    expect(res.status).toBe(409);
    expect(body.message).toBe("สมชาย อยู่ในทีมอื่นแล้ว");
  });

  test("a registration unapproved between the read and the write is refused", async () => {
    const a = await register("a", "football");
    const team = (await createTeam("football")).body.team as Team;
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update sport_registration set status = 'review' where id = '${a}'`);
    };
    const { res } = await send("tech", "PUT", `/${team.id}/members`, {
      registrationIds: [a],
      version: 1,
    });
    expect(res.status).toBe(409);
    expect(await t.db.select().from(competitionTeamMember)).toHaveLength(0);
  });

  test("a member no longer approved shows as an issue", async () => {
    const a = await register("a", "badminton-singles-male");
    const team = (await createTeam("badminton-singles-male")).body.team as Team;
    await send("tech", "PUT", `/${team.id}/members`, { registrationIds: [a], version: 1 });
    await t.db
      .update(sportRegistration)
      .set({ status: "rejected" })
      .where(eq(sportRegistration.id, a));
    const { body } = await send(
      "sports-staff",
      "GET",
      `/?divisionId=${await t.divisionId("badminton-singles-male")}`,
    );
    const [listed] = body.items as Team[];
    expect(listed?.issues.map((issue) => issue.code)).toEqual(["notApproved"]);
    expect(body.canManage).toBe(false);
  });
});

describe("division page", () => {
  test("lists the division's teams and athletes, by institution", async () => {
    await register("a", "football", "kmutt", { shirt: 7 });
    await register("b", "football", "kmitl");
    await register("x", "football", "kmutt", { status: "rejected" });
    await createTeam("football");
    const divisionId = await t.divisionId("football");
    const all = await send("tech", "GET", `/division/${divisionId}`);
    expect(all.res.status).toBe(200);
    expect(all.body.division).toMatchObject({
      code: "football",
      maxTeamsPerInstitution: 1,
      teamMaxSize: 25,
    });
    // Rejected registrations not in a team are left out.
    expect((all.body.athletes as unknown[]).length).toBe(2);
    expect(all.body.canManage).toBe(true);

    const kmutt = await send("tech", "GET", `/division/${divisionId}?institution=kmutt`);
    const athletes = kmutt.body.athletes as {
      registrationId: string;
      shirtNumber: number;
      teamId: null;
    }[];
    expect(athletes).toHaveLength(1);
    expect(athletes[0]).toMatchObject({
      shirtNumber: 7,
      teamId: null,
      firstName: "สมชาย",
      lastName: "a",
    });
    expect(kmutt.body.teams as Team[]).toHaveLength(1);
    expect((await send("tech", "GET", "/division/nope")).res.status).toBe(404);
  });
});

describe("auto", () => {
  test("puts every approved athlete into team 1, creating it", async () => {
    await register("a", "football");
    await register("b", "football");
    await register("c", "football", "kmutt", { status: "review" });
    const divisionId = await t.divisionId("football");
    const { res, body } = await send("tech", "POST", "/auto", {
      divisionId,
      institution: "kmutt",
      teamCount: 1,
    });
    expect(res.status).toBe(200);
    const [team] = body.items as Team[];
    expect(team?.seq).toBe(1);
    expect(team?.members).toHaveLength(2);
    expect((await audit()).at(-1)).toMatchObject({ action: "auto", entityId: divisionId });
  });

  test("deals athletes into n teams, by badminton rank first, replacing what was there", async () => {
    const r1 = await register("r1", "badminton-singles-male", "kmutt", { rank: 1 });
    const r2 = await register("r2", "badminton-singles-male", "kmutt", { rank: 2 });
    const one = (await createTeam("badminton-singles-male")).body.team as Team;
    await send("tech", "PUT", `/${one.id}/members`, { registrationIds: [r2], version: 1 });
    const divisionId = await t.divisionId("badminton-singles-male");
    const { body } = await send("tech", "POST", "/auto", {
      divisionId,
      institution: "kmutt",
      teamCount: 2,
    });
    const teams = body.items as Team[];
    expect(teams.map((team) => team.members.map((member) => member.registrationId))).toEqual([
      [r1],
      [r2],
    ]);
    expect(teams[0]?.id).toBe(one.id);
    expect(teams[0]?.version).toBe(3);
  });

  test("refuses more teams than allowed", async () => {
    const divisionId = await t.divisionId("football");
    const { res } = await send("tech", "POST", "/auto", {
      divisionId,
      institution: "kmutt",
      teamCount: 2,
    });
    expect(res.status).toBe(400);
  });

  test("an athlete approved meanwhile makes the deal stale", async () => {
    await register("a", "football");
    const late = await register("b", "football", "kmutt", { status: "review" });
    const divisionId = await t.divisionId("football");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update sport_registration set status = 'approved' where id = '${late}'`);
    };
    const { res } = await send("tech", "POST", "/auto", {
      divisionId,
      institution: "kmutt",
      teamCount: 1,
    });
    expect(res.status).toBe(409);
    expect(await t.db.select().from(competitionTeam)).toHaveLength(0);
  });
});

describe("officials", () => {
  const official = (name: string) => ({
    name,
    position: "ผู้ฝึกสอน",
    description: null,
    photoUrl: "https://example.com/coach.jpg",
    sortOrder: 0,
  });

  test("adds, edits and removes officials up to the division's cap", async () => {
    // Football allows two officials.
    const team = (await createTeam("football")).body.team as Team;
    const added = await send("tech", "POST", `/${team.id}/officials`, official("โค้ชเอ"));
    expect(added.res.status).toBe(201);
    const id = (added.body.official as { id: string }).id;
    expect((await send("tech", "POST", `/${team.id}/officials`, official("โค้ชบี"))).res.status).toBe(
      201,
    );
    const third = await send("tech", "POST", `/${team.id}/officials`, official("โค้ชซี"));
    expect(third.res.status).toBe(409);
    expect(third.body.message).toBe("เจ้าหน้าที่ทีมมีได้ไม่เกิน 2 คน");

    const edited = await send("tech", "PUT", `/${team.id}/officials/${id}`, {
      ...official("โค้ชเอ"),
      photoUrl: "",
      position: "ผู้จัดการทีม",
    });
    expect(edited.res.status).toBe(200);
    expect(edited.body.official).toMatchObject({ photoUrl: null, position: "ผู้จัดการทีม" });

    expect((await send("tech", "DELETE", `/${team.id}/officials/${id}`)).res.status).toBe(200);
    expect((await send("tech", "DELETE", `/${team.id}/officials/${id}`)).res.status).toBe(404);
    const actions = (await audit()).map((row) => row.action);
    expect(actions).toContain("official.add");
    expect(actions).toContain("official.update");
    expect(actions).toContain("official.remove");
  });

  test("an official added by someone else meanwhile is caught by the cap", async () => {
    const team = (await createTeam("football")).body.team as Team;
    await send("tech", "POST", `/${team.id}/officials`, official("โค้ชเอ"));
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into competition_team_official (id, team_id, name) values ('racer', '${team.id}', 'แทรก')`,
      );
    };
    const { res } = await send("tech", "POST", `/${team.id}/officials`, official("โค้ชบี"));
    expect(res.status).toBe(409);
  });

  test("refuses links that are not https", async () => {
    const team = (await createTeam("football")).body.team as Team;
    const { res } = await send("tech", "POST", `/${team.id}/officials`, {
      ...official("โค้ช"),
      photoUrl: "http://example.com/a.jpg",
    });
    expect(res.status).toBe(400);
  });
});

describe("lineups", () => {
  async function matchWithMembers() {
    const seeded = await seedMatch(t);
    const side = defined(seeded.sides[1]); // KMUTT
    const teamId = defined(side.teamId);
    const ids: string[] = [];
    for (const name of ["p1", "p2", "p3"]) ids.push(await register(name, "football"));
    await send("tech", "PUT", `/${teamId}/members`, { registrationIds: ids, version: 1 });
    return { ...seeded, side, teamId, ids };
  }

  test("sets starters and subs from the team, and reads them back", async () => {
    const { match, side, ids } = await matchWithMembers();
    const path = `/lineups/${match.id}/${side.id}`;
    const saved = await send("tech", "PUT", path, { starters: [ids[0], ids[1]], subs: [ids[2]] });
    expect(saved.res.status).toBe(200);
    const read = await send("sports-staff", "GET", path);
    expect(read.body).toMatchObject({
      starters: [ids[0], ids[1]],
      subs: [ids[2]],
      limits: { starters: 11, maxSubs: 14 },
      canEdit: false,
      locked: false,
    });
    expect((read.body.team as Team).members).toHaveLength(3);
    expect((await audit()).at(-1)).toMatchObject({ entity: "lineup", entityId: side.id });
  });

  test("match managers may set lineups; score keepers may not", async () => {
    const { match, side, ids } = await matchWithMembers();
    const path = `/lineups/${match.id}/${side.id}`;
    expect(
      (await send("sports-head", "PUT", path, { starters: [ids[0]], subs: [] })).res.status,
    ).toBe(200);
    expect(
      (await send("sports-staff", "PUT", path, { starters: [ids[0]], subs: [] })).res.status,
    ).toBe(403);
    expect(
      (await send("reg-kmitl", "PUT", path, { starters: [ids[0]], subs: [] })).res.status,
    ).toBe(403);
  });

  test("refuses outsiders, duplicates and too many players", async () => {
    const { match, side, ids, divisionId } = await matchWithMembers();
    const path = `/lineups/${match.id}/${side.id}`;
    const outsider = await register("out", "football", "kmitl");
    expect((await send("tech", "PUT", path, { starters: [outsider], subs: [] })).res.status).toBe(
      400,
    );
    expect(
      (await send("tech", "PUT", path, { starters: [ids[0]], subs: [ids[0]] })).res.status,
    ).toBe(400);
    await t.db
      .update(sportDivision)
      .set({ lineupStarters: 1, lineupMaxSubs: 1 })
      .where(eq(sportDivision.id, divisionId));
    const many = await send("tech", "PUT", path, { starters: [ids[0], ids[1]], subs: [] });
    expect(many.res.status).toBe(400);
    expect(many.body.message).toBe("ตัวจริงได้ไม่เกิน 1 คน");
    expect(
      (await send("tech", "PUT", path, { starters: [ids[0]], subs: [ids[1], ids[2]] })).res.status,
    ).toBe(400);
  });

  test("a finished match's lineup is locked", async () => {
    const { match, side, ids } = await matchWithMembers();
    await t.db
      .update(competitionMatch)
      .set({ status: "finished" })
      .where(eq(competitionMatch.id, match.id));
    const { res } = await send("tech", "PUT", `/lineups/${match.id}/${side.id}`, {
      starters: [ids[0]],
      subs: [],
    });
    expect(res.status).toBe(409);
  });

  test("a member removed from the team leaves upcoming lineups", async () => {
    const { match, side, teamId, ids } = await matchWithMembers();
    await send("tech", "PUT", `/lineups/${match.id}/${side.id}`, {
      starters: [ids[0], ids[1]],
      subs: [],
    });
    await send("tech", "PUT", `/${teamId}/members`, {
      registrationIds: [ids[1], ids[2]],
      version: 2,
    });
    const rows = await t.db.select().from(competitionLineup);
    expect(rows.map((row) => row.registrationId)).toEqual([ids[1] as string]);
  });

  test("unknown matches and sides are 404", async () => {
    const { match } = await matchWithMembers();
    expect((await send("tech", "GET", `/lineups/${match.id}/nope`)).res.status).toBe(404);
    expect((await send("tech", "GET", "/lineups/nope/nope")).res.status).toBe(404);
  });
});
