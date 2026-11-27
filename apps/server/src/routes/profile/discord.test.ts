import { beforeEach, describe, expect, test } from "bun:test";
import { account } from "@it3k/db/schema/auth";
import { sportRegistration } from "@it3k/db/schema/sport";
import type { RegistrationStatus } from "@it3k/db/sport-rules";

import { createTestContext } from "../../testing";
import { createProfileRoutes } from ".";

let t: ReturnType<typeof createTestContext>;

beforeEach(async () => {
  t = createTestContext();
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("sports-head", { department: "กีฬา", seat: "head" });
  await t.seedUser("art", { department: "Art" });
  await t.seedUser("admin", { role: "admin" });
});

const routes = (discordEnabled = true) =>
  createProfileRoutes({
    ...t.deps,
    discordEnabled,
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
    await t.db.insert(account).values({
      id: "acc-tech",
      accountId: "123456789012345678",
      providerId: "discord",
      userId: "tech",
      updatedAt: new Date(),
    });
    expect((await discordOf("tech")).body.linked).toEqual({
      accountId: "acc-tech",
      userId: "123456789012345678",
      username: "name-of-acc-tech",
      displayName: "Display",
      avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png",
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
