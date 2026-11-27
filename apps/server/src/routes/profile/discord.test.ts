import { beforeEach, describe, expect, test } from "bun:test";
import { account } from "@it3k/db/schema/auth";
import { sportRegistration } from "@it3k/db/schema/sport";
import type { RegistrationStatus } from "@it3k/db/sport-rules";

import { createTestContext } from "../../testing";
import type { GuildJoinResult } from "../registrations/shared";
import { createProfileRoutes } from ".";

let t: ReturnType<typeof createTestContext>;

beforeEach(async () => {
  t = createTestContext();
  joins = [];
  joinResult = async () => ({ status: "joined", url: "https://discord.com/channels/42" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("sports-head", { department: "กีฬา", seat: "head" });
  await t.seedUser("art", { department: "Art" });
  await t.seedUser("admin", { role: "admin" });
});

let joins: { accountRecordId: string; discordUserId: string }[] = [];
let joinResult: () => Promise<GuildJoinResult> = async () => ({
  status: "joined",
  url: "https://discord.com/channels/42",
});

const routes = (discordEnabled = true, guild = true) =>
  createProfileRoutes({
    ...t.deps,
    discordEnabled,
    discordGuildJoin: guild
      ? async ({ accountRecordId, discordUserId }) => {
          joins.push({ accountRecordId, discordUserId });
          return joinResult();
        }
      : null,
    discordProfile: async (_headers, accountId) => ({
      username: `name-of-${accountId}`,
      displayName: "Display",
      avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png",
    }),
  });

async function discordOf(userId: string | null, app = routes()) {
  const res = await app.request("/discord", t.as(userId));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function linkDiscord(userId: string, scope: string | null) {
  await t.db.insert(account).values({
    id: `acc-${userId}`,
    accountId: "123456789012345678",
    providerId: "discord",
    userId,
    scope,
    updatedAt: new Date(),
  });
}

async function enter(userId: string, code: string, status: RegistrationStatus) {
  await t.db.insert(sportRegistration).values({
    userId,
    divisionId: await t.divisionId(code),
    institution: "kmutt",
    status,
  });
}

describe("GET /api/profile/discord", () => {
  test("Tech/Live and กีฬา staff, heads included, and admins are its staff", async () => {
    for (const who of ["tech", "sports-head", "admin"]) {
      expect((await discordOf(who)).body).toEqual({
        enabled: true,
        audience: { staff: true, athlete: false },
        canJoinGuild: true,
        linked: null,
      });
    }
  });

  test("staff of other departments are not its audience", async () => {
    expect((await discordOf("art")).body.audience).toEqual({ staff: false, athlete: false });
  });

  test("esports entrants are, until they are turned down; other sports do not count", async () => {
    await t.seedParticipant("p1");
    await enter("p1", "esports-tft", "review");
    expect((await discordOf("p1")).body.audience).toEqual({ staff: false, athlete: true });

    await t.seedParticipant("p2");
    await enter("p2", "esports-rov", "rejected");
    expect((await discordOf("p2")).body.audience).toEqual({ staff: false, athlete: false });

    await t.seedParticipant("p3");
    expect((await discordOf("p3")).body.audience).toEqual({ staff: false, athlete: false });
  });

  test("shows the linked account with its name and avatar", async () => {
    await linkDiscord("tech", "identify,email");
    expect((await discordOf("tech")).body.linked).toEqual({
      accountId: "acc-tech",
      userId: "123456789012345678",
      username: "name-of-acc-tech",
      displayName: "Display",
      avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png",
      guildsJoin: false,
    });
  });

  test("tells whether the link may join the guild, and whether this stage can", async () => {
    await linkDiscord("tech", "identify,email,guilds.join");
    expect((await discordOf("tech")).body.linked).toMatchObject({ guildsJoin: true });
    expect((await discordOf("tech", routes(true, false))).body).toMatchObject({
      canJoinGuild: false,
    });
  });

  test("reports Discord turned off when no app is configured", async () => {
    expect((await discordOf("tech", routes(false))).body).toMatchObject({ enabled: false });
    expect((await discordOf("tech", createProfileRoutes(t.deps))).body).toMatchObject({
      enabled: false,
    });
  });

  test("needs a signed-in account", async () => {
    expect((await discordOf(null)).status).toBe(401);
  });
});

describe("POST /api/profile/discord/join", () => {
  const join = async (userId: string | null, app = routes(), init = {}) => {
    const res = await app.request(
      "/discord/join",
      t.as(userId, { method: "POST", json: {}, ...init }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  test("joins with the linked account and passes on where to open the guild", async () => {
    await linkDiscord("tech", "identify,email,guilds.join");
    expect(await join("tech")).toEqual({
      status: 200,
      body: { status: "joined", url: "https://discord.com/channels/42" },
    });
    expect(joins).toEqual([{ accountRecordId: "acc-tech", discordUserId: "123456789012345678" }]);
  });

  test("esports entrants may join too", async () => {
    await t.seedParticipant("p1");
    await enter("p1", "esports-tft", "approved");
    await linkDiscord("p1", "identify guilds.join");
    expect((await join("p1")).body).toMatchObject({ status: "joined" });
  });

  test("asks for consent again when the link predates guilds.join, without calling Discord", async () => {
    await linkDiscord("tech", "identify,email");
    expect(await join("tech")).toEqual({ status: 200, body: { status: "consent" } });
    expect(joins).toEqual([]);
  });

  test("refuses accounts the guild is not for", async () => {
    await linkDiscord("art", "identify,email,guilds.join");
    expect((await join("art")).status).toBe(403);
    expect(joins).toEqual([]);
  });

  test("needs a linked account, and a stage with the bot's token", async () => {
    expect((await join("tech")).status).toBe(400);
    await linkDiscord("tech", "identify,email,guilds.join");
    expect((await join("tech", routes(true, false))).status).toBe(409);
  });

  test("reports Discord refusing as a 502", async () => {
    await linkDiscord("tech", "identify,email,guilds.join");
    joinResult = async () => {
      throw new Error("Missing Permissions");
    };
    expect((await join("tech")).status).toBe(502);
  });

  test("is refused while impersonating, and signed out", async () => {
    await linkDiscord("tech", "identify,email,guilds.join");
    expect((await join("tech", routes(), { impersonatedBy: "admin" })).status).toBe(403);
    expect((await join(null)).status).toBe(401);
    expect(joins).toEqual([]);
  });
});
