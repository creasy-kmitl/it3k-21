import { describe, expect, test } from "bun:test";
import { botToken } from "@it3k/db/schema/bot-token";
import { createTestDb } from "@it3k/db/testing";
import { Hono } from "hono";

// The real server routes, so this also checks the bot and server agree.
import { hashBotToken, newBotToken } from "../../../../server/src/middleware/bot-token";
import { createBotRoutes } from "../../../../server/src/routes/bot";
import { ping } from "./api";

const TOKEN = newBotToken();
const URL = "http://api.test";

/** The server's /api/bot with TOKEN issued, as an admin would on the dashboard. */
async function serverFetch(): Promise<typeof fetch> {
  const { db } = createTestDb();
  await db.insert(botToken).values({
    name: "esport",
    prefix: TOKEN.slice(0, 12),
    tokenHash: await hashBotToken(TOKEN),
  });
  const app = new Hono().route(
    "/api/bot",
    createBotRoutes({ getDb: () => db, stage: "staging", webOrigin: "https://web.test" }),
  );
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    app.request(input instanceof Request ? input : String(input), init)) as typeof fetch;
}

describe("ping", () => {
  test("reports the stage the server answers from", async () => {
    const result = await ping({ url: `${URL}/`, token: TOKEN }, await serverFetch());
    expect(result).toMatchObject({ ok: true, stage: "staging" });
  });

  test("a wrong or revoked token points to the dashboard", async () => {
    const result = await ping({ url: URL, token: newBotToken() }, await serverFetch());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("/staff/bot-tokens");
  });

  test("a stage without bot routes says so", async () => {
    const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const result = await ping({ url: URL, token: TOKEN }, notFound);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("/api/bot");
  });

  test("no token never reaches the network", async () => {
    const result = await ping({ url: URL, token: undefined }, (() => {
      throw new Error("must not fetch");
    }) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
  });

  test("an unreachable server is reported, not thrown", async () => {
    const result = await ping({ url: URL, token: TOKEN }, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ECONNREFUSED");
  });
});
