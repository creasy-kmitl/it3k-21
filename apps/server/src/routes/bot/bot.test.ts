import { describe, expect, test } from "bun:test";

import { createTestContext } from "../../testing";
import { createBotRoutes } from ".";

const TOKEN = "t".repeat(40);

function app(botToken = TOKEN) {
  const t = createTestContext();
  return createBotRoutes({ ...t.deps, botToken, stage: "staging" });
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("bot routes", () => {
  test("the right token gets through and sees the stage", async () => {
    const res = await app().request("/ping", bearer(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stage: "staging" });
  });

  test("no token is refused", async () => {
    const res = await app().request("/ping");
    expect(res.status).toBe(401);
  });

  test("a wrong token is refused, even one that shares a prefix", async () => {
    expect((await app().request("/ping", bearer("wrong"))).status).toBe(401);
    expect((await app().request("/ping", bearer(TOKEN.slice(0, -1)))).status).toBe(401);
    expect((await app().request("/ping", bearer(`${TOKEN}x`))).status).toBe(401);
  });

  test("a token outside the Bearer scheme is refused", async () => {
    const res = await app().request("/ping", { headers: { authorization: TOKEN } });
    expect(res.status).toBe(401);
  });

  test("a stage without a token has no bot routes, whatever is sent", async () => {
    const routes = app("");
    expect((await routes.request("/ping")).status).toBe(404);
    expect((await routes.request("/ping", bearer(""))).status).toBe(404);
    expect((await routes.request("/ping", bearer(TOKEN))).status).toBe(404);
  });
});
