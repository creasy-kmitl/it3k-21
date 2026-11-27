import { beforeEach, describe, expect, test } from "bun:test";
import { BOT_TOKEN_PREFIX } from "@it3k/db/bot-token-rules";
import { botToken } from "@it3k/db/schema/index";

import { createTestContext, readJson } from "../../testing";
import { createBotRoutes } from "../bot";
import { createBotTokenRoutes } from ".";

type Listed = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdByName: string | null;
};
type Issued = Listed & { token: string };

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createBotTokenRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createBotTokenRoutes(t.deps);
  await t.seedUser("admin", { role: "admin", name: "Admin" });
  await t.seedUser("tech-head", { seat: "head", department: "Tech/Live", name: "Tech Head" });
  await t.seedUser("staff", { department: "Art", name: "Art Staff" });
});

async function send<T = unknown>(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

const issue = (name = "esport bot", who = "admin") => send<Issued>(who, "POST", "/", { name });

const bot = () => createBotRoutes({ ...t.deps, stage: "dev", webOrigin: "http://localhost:3001" });
const ping = (token: string) =>
  bot().request("/ping", { headers: { authorization: `Bearer ${token}` } });

describe("bot tokens", () => {
  test("an admin issues a token, shown once, that the bot routes accept", async () => {
    const { res, body } = await issue();
    expect(res.status).toBe(201);
    expect(body.token.startsWith(BOT_TOKEN_PREFIX)).toBe(true);
    expect(body.token.length).toBeGreaterThan(40);
    expect(body.token.startsWith(body.prefix)).toBe(true);
    expect(body.createdByName).toBe("Admin");
    expect((await ping(body.token)).status).toBe(200);

    // The list never has the token or its hash.
    const list = await send<{ items: Record<string, unknown>[] }>("admin", "GET", "/");
    expect(list.res.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty("token");
    expect(list.body.items[0]).not.toHaveProperty("tokenHash");
    expect(list.body.items[0]?.lastUsedAt).not.toBeNull();

    // Nor does the table: only the hash.
    const [row] = await t.db.select().from(botToken);
    expect(row?.tokenHash).not.toContain(body.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("every token is different", async () => {
    const a = await issue("a");
    const b = await issue("b");
    expect(a.body.token).not.toBe(b.body.token);
  });

  test("revoking stops the token at once and keeps it listed", async () => {
    const { body } = await issue();
    const revoked = await send<Listed>("admin", "DELETE", `/${body.id}`);
    expect(revoked.res.status).toBe(200);
    expect(revoked.body.revokedAt).not.toBeNull();
    expect((await ping(body.token)).status).toBe(401);

    const again = await send("admin", "DELETE", `/${body.id}`);
    expect(again.res.status).toBe(404);
    const list = await send<{ items: Listed[] }>("admin", "GET", "/");
    expect(list.body.items[0]?.revokedAt).not.toBeNull();
  });

  test("only admins see or manage tokens", async () => {
    const { body } = await issue();
    for (const who of ["tech-head", "staff"]) {
      expect((await send(who, "GET", "/")).res.status).toBe(403);
      expect((await issue("x", who)).res.status).toBe(403);
      expect((await send(who, "DELETE", `/${body.id}`)).res.status).toBe(403);
    }
    expect((await ping(body.token)).status).toBe(200);
  });

  test("a name is required", async () => {
    expect((await issue("   ")).res.status).toBe(400);
    expect((await issue("x".repeat(61))).res.status).toBe(400);
  });

  test("an admin who lost the role meanwhile issues nothing", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update user set role = 'staff' where id = 'admin'`);
    };
    const { res } = await issue();
    expect(res.status).toBe(409);
    expect(await t.db.select().from(botToken)).toHaveLength(0);
  });
});
