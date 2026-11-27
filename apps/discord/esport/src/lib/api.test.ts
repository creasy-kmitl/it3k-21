import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

// The real server routes, so this also checks the bot and server agree.
import { createBotRoutes } from "../../../../server/src/routes/bot";
import { ping } from "./api";

const TOKEN = "s".repeat(40);
const URL = "http://api.test";

function serverFetch(botToken = TOKEN): typeof fetch {
  const app = new Hono().route(
    "/api/bot",
    createBotRoutes({
      getDb: () => {
        throw new Error("ping needs no database");
      },
      botToken,
      stage: "staging",
    }),
  );
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    app.request(input instanceof Request ? input : String(input), init)) as typeof fetch;
}

describe("ping", () => {
  test("reports the stage the server answers from", async () => {
    const result = await ping({ url: `${URL}/`, token: TOKEN }, serverFetch());
    expect(result).toMatchObject({ ok: true, stage: "staging" });
  });

  test("a wrong token says the tokens differ", async () => {
    const result = await ping({ url: URL, token: "nope" }, serverFetch());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ไม่ตรงกัน");
  });

  test("a stage without bot routes says so", async () => {
    const result = await ping({ url: URL, token: TOKEN }, serverFetch(""));
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
