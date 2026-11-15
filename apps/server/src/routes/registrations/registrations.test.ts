import { beforeEach, describe, expect, test } from "bun:test";
import {
  account,
  athlete,
  sportDivision,
  sportRegistration,
  sportRegistrationChange,
  user,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createRegistrationRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createRegistrationRoutes>;
let discordEnabled: boolean;

const fields = { shirtNumber: null, badmintonRank: null, ign: "", ignReading: "", facebookUrl: "" };

async function linkDiscord(userId: string) {
  await t.db.insert(account).values({
    id: `acc-${userId}`,
    accountId: `discord-${userId}`,
    providerId: "discord",
    userId,
    updatedAt: new Date(),
  });
}

beforeEach(async () => {
  t = createTestContext();
  discordEnabled = true;
  app = createRegistrationRoutes({
    ...t.deps,
    get discordEnabled() {
      return discordEnabled;
    },
    discordProfile: async (_headers, accountId) => ({ username: `name-of-${accountId}` }),
  });
  await t.seedParticipant("a1");
  await t.seedParticipant("a2");
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

async function register(userId: string, code: string, extra: Record<string, unknown> = {}) {
  return send(userId, "POST", "/", {
    divisionId: await t.divisionId(code),
    studentId: "65070001",
    ...fields,
    ...extra,
  });
}

describe("registering", () => {
  test("the first registration records the student id and the profile's institution", async () => {
    const { res, body } = await register("a1", "athletics-100m-male");
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      status: "review",
      institution: "kmutt",
      division: { code: "athletics-100m-male" },
      sport: { code: "athletics" },
    });
    const [row] = await t.db.select().from(athlete).where(eq(athlete.userId, "a1"));
    expect(defined(row).studentId).toBe("65070001");
    const [account] = await t.db.select().from(user).where(eq(user.id, "a1"));
    expect(defined(account).institution).toBe("kmutt");
    const log = await t.db.select().from(sportRegistrationChange);
    expect(log).toMatchObject([{ action: "register", actorUserId: "a1", athleteUserId: "a1" }]);
  });

  test("one account may register for many divisions, but each once", async () => {
    expect((await register("a1", "athletics-100m-male")).res.status).toBe(201);
    // Later registrations need no student id.
    const second = await send("a1", "POST", "/", {
      divisionId: await t.divisionId("athletics-400m-male"),
      ...fields,
    });
    expect(second.res.status).toBe(201);
    const again = await register("a1", "athletics-100m-male");
    expect(again.res.status).toBe(409);
    expect(again.body.message).toBe("สมัครประเภทนี้ไว้แล้ว");
    const me = await send("a1", "GET", "/me");
    expect((me.body.registrations as unknown[]).length).toBe(2);
    expect(me.body).toMatchObject({ profileSubmitted: true, studentId: "65070001" });
  });

  test("needs a submitted profile, an institution and, at first, a student id", async () => {
    await t.seedUser("guest", { role: "guest" });
    expect((await register("guest", "football")).res.status).toBe(409);
    await t.seedParticipant("nowhere", "");
    expect((await register("nowhere", "football")).body.message).toBe(
      "ระบุสถาบันในข้อมูลผู้เข้าร่วมก่อนสมัครกีฬา",
    );
    const noId = await register("a1", "athletics-100m-male", { studentId: undefined });
    expect(noId.res.status).toBe(400);
    expect(noId.body.issues).toEqual([{ path: ["studentId"], message: "กรอกรหัสนักศึกษา" }]);
  });

  test("asks for each division's own fields and drops the rest", async () => {
    const noShirt = await register("a1", "football");
    expect(noShirt.res.status).toBe(400);
    expect(noShirt.body.message).toBe("กรอกเบอร์เสื้อ");
    const ok = await register("a1", "football", { shirtNumber: 10, badmintonRank: 1, ign: "x" });
    expect(ok.body).toMatchObject({ shirtNumber: 10, badmintonRank: null, ign: "" });
    expect((await register("a2", "badminton-singles-male")).body.message).toBe("เลือกมือ 1 หรือ มือ 2");
  });

  test("shirt numbers and badminton ranks are unique per team, not across teams", async () => {
    await t.seedParticipant("kmitl-1", "kmitl");
    expect((await register("a1", "football", { shirtNumber: 7 })).res.status).toBe(201);
    const clash = await register("a2", "football", { shirtNumber: 7 });
    expect(clash.res.status).toBe(409);
    expect(clash.body.message).toBe("เบอร์เสื้อนี้มีคนในทีมเดียวกันใช้แล้ว");
    expect((await register("kmitl-1", "football", { shirtNumber: 7 })).res.status).toBe(201);

    expect((await register("a1", "badminton-singles-male", { badmintonRank: 1 })).res.status).toBe(
      201,
    );
    expect(
      (await register("a2", "badminton-singles-male", { badmintonRank: 1 })).body.message,
    ).toBe("มือนี้ของสถาบันมีผู้สมัครแล้ว");
    expect((await register("a2", "badminton-singles-male", { badmintonRank: 2 })).res.status).toBe(
      201,
    );
  });

  test("a rejected registration frees its shirt number", async () => {
    await register("a1", "football", { shirtNumber: 7 });
    await t.db.update(sportRegistration).set({ status: "rejected" });
    expect((await register("a2", "football", { shirtNumber: 7 })).res.status).toBe(201);
  });

  test("closed divisions and full quotas refuse, also when they close mid-request", async () => {
    const football = await t.divisionId("football");
    await t.db
      .update(sportDivision)
      .set({ registrationOpen: false })
      .where(eq(sportDivision.id, football));
    expect((await register("a1", "football", { shirtNumber: 1 })).body.message).toBe(
      "ประเภทนี้ปิดรับสมัครแล้ว",
    );

    const sprint = await t.divisionId("athletics-100m-male");
    await t.db
      .update(sportDivision)
      .set({ maxPerInstitution: 1 })
      .where(eq(sportDivision.id, sprint));
    expect((await register("a1", "athletics-100m-male")).res.status).toBe(201);
    const full = await register("a2", "athletics-100m-male");
    expect(full.res.status).toBe(409);

    const relay = await t.divisionId("athletics-4x100m-male");
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`update sport_division set registration_open = 0 where id = '${relay}'`);
    };
    expect((await register("a2", "athletics-4x100m-male")).res.status).toBe(409);
    expect(await t.db.select().from(athlete).where(eq(athlete.userId, "a2"))).toEqual([]);
  });

  test("esports needs the game profile and a linked Discord account", async () => {
    const profile = { ign: "Faker", ignReading: "เฟเกอร์", facebookUrl: "https://facebook.com/f" };
    expect((await register("a1", "esports-rov")).body.message).toBe("กรอกชื่อในเกม (IGN)");
    expect((await register("a1", "esports-rov", profile)).body.message).toBe(
      "เชื่อมบัญชี Discord ก่อนสมัครกีฬา Esports",
    );
    expect(
      (await register("a1", "esports-rov", { ...profile, facebookUrl: "https://evil.test/" })).res
        .status,
    ).toBe(400);
    await linkDiscord("a1");
    const ok = await register("a1", "esports-rov", profile);
    expect(ok.res.status).toBe(201);
    expect(ok.body).toMatchObject({
      ign: "Faker",
      discordUserId: "discord-a1",
      discordUsername: "name-of-acc-a1",
    });
    expect((await send("a1", "GET", "/me")).body.discord).toEqual({
      enabled: true,
      linked: { accountId: "acc-a1", userId: "discord-a1", username: "name-of-acc-a1" },
    });
  });

  test("esports is closed while no Discord app is configured", async () => {
    discordEnabled = false;
    await linkDiscord("a1");
    const res = await register("a1", "esports-tft", {
      ign: "x",
      ignReading: "x",
      facebookUrl: "https://facebook.com/x",
    });
    expect(res.res.status).toBe(409);
  });
});

describe("editing and withdrawing", () => {
  test("athletes edit and withdraw their own registration while it is in review", async () => {
    const { body } = await register("a1", "football", { shirtNumber: 7 });
    const id = body.id as string;
    expect(
      (await send("a2", "PUT", `/${id}`, { ...fields, shirtNumber: 8, version: 1 })).res.status,
    ).toBe(404);
    const edited = await send("a1", "PUT", `/${id}`, { ...fields, shirtNumber: 8, version: 1 });
    expect(edited.body).toMatchObject({ shirtNumber: 8, version: 2 });
    // A stale version is refused.
    expect(
      (await send("a1", "PUT", `/${id}`, { ...fields, shirtNumber: 9, version: 1 })).res.status,
    ).toBe(409);
    expect((await send("a1", "POST", `/${id}/withdraw`, { version: 2 })).res.status).toBe(200);
    expect(await t.db.select().from(sportRegistration)).toEqual([]);
    const actions = (await t.db.select().from(sportRegistrationChange)).map((row) => row.action);
    expect(actions.toSorted()).toEqual(["register", "update", "withdraw"]);
  });

  test("a reviewed registration is locked for the athlete", async () => {
    const { body } = await register("a1", "football", { shirtNumber: 7 });
    await t.db.update(sportRegistration).set({ status: "approved" });
    const id = body.id as string;
    expect(
      (await send("a1", "PUT", `/${id}`, { ...fields, shirtNumber: 8, version: 1 })).res.status,
    ).toBe(409);
    expect((await send("a1", "POST", `/${id}/withdraw`, { version: 1 })).res.status).toBe(409);
  });
});
