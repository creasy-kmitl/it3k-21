import { describe, expect, test } from "bun:test";
import { EMPTY_PROFILE } from "@it3k/db/profile";
import {
  account,
  botToken,
  sportDivision,
  sportRegistration,
  userProfile,
} from "@it3k/db/schema/index";
import type { RegistrationStatus } from "@it3k/db/sport-rules";
import type { Institution } from "@it3k/db/profile";
import { eq } from "drizzle-orm";

import { hashBotToken, newBotToken } from "../../middleware/bot-token";
import { createTestContext, readJson } from "../../testing";
import { createBotRoutes } from ".";

const TOKEN = newBotToken();
const WEB = "https://it3k-staging.creasy.club";

/** Routes with TOKEN issued, as an admin would on the dashboard. */
async function setup() {
  const t = createTestContext();
  await t.db.insert(botToken).values({
    id: "tok",
    name: "esport",
    prefix: TOKEN.slice(0, 12),
    tokenHash: await hashBotToken(TOKEN),
  });
  const app = createBotRoutes({ ...t.deps, stage: "staging", webOrigin: WEB });
  return { t, app };
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("bot token", () => {
  test("an issued token gets through, sees the stage and marks the token used", async () => {
    const { t, app } = await setup();
    const res = await app.request("/ping", bearer(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stage: "staging" });
    const [row] = await t.db.select().from(botToken).where(eq(botToken.id, "tok"));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  test("no token is refused", async () => {
    const { app } = await setup();
    expect((await app.request("/ping")).status).toBe(401);
  });

  test("a wrong token is refused, even one that shares a prefix", async () => {
    const { app } = await setup();
    expect((await app.request("/ping", bearer("wrong"))).status).toBe(401);
    expect((await app.request("/ping", bearer(newBotToken()))).status).toBe(401);
    expect((await app.request("/ping", bearer(TOKEN.slice(0, -1)))).status).toBe(401);
    expect((await app.request("/ping", bearer(`${TOKEN}x`))).status).toBe(401);
  });

  test("a token outside the Bearer scheme is refused", async () => {
    const { app } = await setup();
    const res = await app.request("/ping", { headers: { authorization: TOKEN } });
    expect(res.status).toBe(401);
  });

  test("a revoked token is refused at once", async () => {
    const { t, app } = await setup();
    await t.db.update(botToken).set({ revokedAt: new Date() }).where(eq(botToken.id, "tok"));
    expect((await app.request("/ping", bearer(TOKEN))).status).toBe(401);
    expect((await app.request("/members/123456789012345678", bearer(TOKEN))).status).toBe(401);
  });
});

describe("GET /members/:discordUserId", () => {
  const DISCORD_ID = "123456789012345678";

  async function link(t: ReturnType<typeof createTestContext>, userId: string, id = DISCORD_ID) {
    await t.db.insert(account).values({
      id: `acc-${userId}`,
      accountId: id,
      providerId: "discord",
      userId,
      updatedAt: new Date(),
    });
  }

  async function registration(
    t: ReturnType<typeof createTestContext>,
    userId: string,
    code: string,
    status: RegistrationStatus,
    institution: Institution = "kmutt",
    ign = "",
  ) {
    await t.db.insert(sportRegistration).values({
      userId,
      divisionId: await t.divisionId(code),
      institution,
      status,
      ign,
    });
  }

  async function member(app: Awaited<ReturnType<typeof setup>>["app"], id = DISCORD_ID) {
    const res = await app.request(`/members/${id}`, bearer(TOKEN));
    return { status: res.status, body: await readJson(res) };
  }

  test("an unlinked Discord account gets the page to link it on", async () => {
    const { app } = await setup();
    expect(await member(app)).toEqual({
      status: 200,
      body: { linked: false, linkUrl: `${WEB}/me` },
    });
  });

  test("a staff account is staff with its department, and no esports", async () => {
    const { t, app } = await setup();
    await t.seedUser("s1", { role: "staff", department: "Tech/Live", institution: "kmitl" });
    await link(t, "s1");
    expect((await member(app)).body).toEqual({
      linked: true,
      banned: false,
      staff: true,
      nickname: null,
      institution: "kmitl",
      department: "Tech/Live",
      esports: [],
    });
  });

  test("the nickname comes from the profile, the in-game name from the registration", async () => {
    const { t, app } = await setup();
    await t.seedParticipant("a2");
    await t.db
      .update(userProfile)
      .set({ values: { ...EMPTY_PROFILE, nickname: " ต้น " } })
      .where(eq(userProfile.userId, "a2"));
    await link(t, "a2");
    await registration(t, "a2", "esports-tft", "approved", "kmutt", "TonTFT");
    const { body } = await member(app);
    expect(body).toMatchObject({ nickname: "ต้น", department: null });
    expect(body.esports).toEqual([
      expect.objectContaining({ ign: "TonTFT", institution: "kmutt" }),
    ]);
  });

  test("a draft nickname counts until the profile is submitted", async () => {
    const { t, app } = await setup();
    await t.seedUser("g1", { role: "guest" });
    await t.db
      .insert(userProfile)
      .values({ userId: "g1", draft: { ...EMPTY_PROFILE, nickname: "บี" } });
    await link(t, "g1");
    expect((await member(app)).body).toMatchObject({ nickname: "บี", staff: false });
  });

  test("staff of departments outside the esports Discord are not its staff", async () => {
    const { t, app } = await setup();
    await t.seedUser("art", { role: "staff", department: "Art" });
    await link(t, "art");
    await t.seedUser("sh", { department: "กีฬา", seat: "head" });
    await link(t, "sh", "323456789012345678");
    expect((await member(app)).body).toMatchObject({ staff: false, department: null });
    expect((await member(app, "323456789012345678")).body).toMatchObject({
      staff: true,
      department: "กีฬา",
    });
  });

  test("an admin counts as staff; a participant does not", async () => {
    const { t, app } = await setup();
    await t.seedUser("ad", { role: "admin" });
    await link(t, "ad");
    await t.seedParticipant("p1");
    await link(t, "p1", "223456789012345678");
    expect((await member(app)).body).toMatchObject({ staff: true });
    expect((await member(app, "223456789012345678")).body).toMatchObject({ staff: false });
  });

  test("lists only approved registrations in game divisions", async () => {
    const { t, app } = await setup();
    await t.seedParticipant("a1");
    await link(t, "a1");
    await registration(t, "a1", "esports-rov", "approved", "kmitl");
    await registration(t, "a1", "esports-tft", "review");
    await registration(t, "a1", "esports-valorant", "rejected");
    // A non-game division, approved: not esports.
    const [other] = await t.db
      .select({ code: sportDivision.code })
      .from(sportDivision)
      .where(eq(sportDivision.requiresGameProfile, false))
      .limit(1);
    await registration(t, "a1", String(other?.code), "approved");

    const { body } = await member(app);
    expect(body).toMatchObject({ linked: true, banned: false, staff: false });
    expect(body.esports).toEqual([
      {
        divisionCode: "esports-rov",
        divisionName: "ROV",
        sportName: "กีฬา Esports",
        institution: "kmitl",
        ign: "",
      },
    ]);
  });

  test("a banned account gets nothing", async () => {
    const { t, app } = await setup();
    await t.seedUser("b1", { role: "staff", banned: true });
    await link(t, "b1");
    await registration(t, "b1", "esports-rov", "approved");
    expect((await member(app)).body).toEqual({
      linked: true,
      banned: true,
      staff: false,
      nickname: null,
      institution: null,
      department: null,
      esports: [],
    });
  });

  test("an id that is not a Discord snowflake is refused", async () => {
    const { app } = await setup();
    expect((await member(app, "abc")).status).toBe(400);
    expect((await member(app, "1' OR 1=1")).status).toBe(400);
  });
});
