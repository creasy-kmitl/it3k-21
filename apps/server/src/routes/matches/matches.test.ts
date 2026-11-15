import { beforeEach, describe, expect, test } from "bun:test";

import { createTestContext, readJson } from "../../testing";
import { createMatchRoutes, createPublicScoreRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createMatchRoutes>;
let publicApp: ReturnType<typeof createPublicScoreRoutes>;

type Match = {
  id: string;
  sport: string;
  teamA: string;
  teamB: string;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
  version: number;
  updatedBy: { id: string; name: string } | null;
};

beforeEach(async () => {
  t = createTestContext();
  app = createMatchRoutes(t.deps);
  publicApp = createPublicScoreRoutes(t.deps);
  await t.seedUser("art", { department: "Art" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("guest", { role: "guest" });
});

async function send<T = Record<string, unknown>>(
  userId: string | null,
  method: string,
  path: string,
  json?: unknown,
) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

async function create(input: Record<string, unknown> = {}) {
  const { res, body } = await send<Match>("art", "POST", "/", {
    sport: "ฟุตบอล",
    teamA: "kmutt",
    teamB: "kmitl",
    ...input,
  });
  expect(res.status).toBe(201);
  return body;
}

describe("matches", () => {
  test("a member records a match and corrects its score", async () => {
    const created = await create();
    expect(created).toMatchObject({ scoreA: null, status: "scheduled", version: 1 });

    const { res, body } = await send<Match>("tech", "PATCH", `/${created.id}`, {
      version: 1,
      scoreA: 2,
      scoreB: 1,
      status: "finished",
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ scoreA: 2, scoreB: 1, status: "finished", version: 2 });
    expect(body.updatedBy?.id).toBe("tech");

    const fixed = await send<Match>("art", "PATCH", `/${created.id}`, { version: 2, scoreB: 3 });
    expect(fixed.body).toMatchObject({ scoreA: 2, scoreB: 3, version: 3 });
  });

  test("an edit based on an old read is refused and changes nothing", async () => {
    const created = await create();
    await send("art", "PATCH", `/${created.id}`, { version: 1, scoreA: 1 });
    const stale = await send("tech", "PATCH", `/${created.id}`, { version: 1, scoreA: 5 });
    expect(stale.res.status).toBe(409);
    const { body } = await send<{ items: Match[] }>("art", "GET", "/");
    expect(body.items[0]).toMatchObject({ scoreA: 1, version: 2 });
  });

  test("a match needs two different universities", async () => {
    const same = await send("art", "POST", "/", { sport: "ฟุตบอล", teamA: "kmutt", teamB: "kmutt" });
    expect(same.res.status).toBe(400);
    const created = await create();
    const swapped = await send("art", "PATCH", `/${created.id}`, { version: 1, teamB: "kmutt" });
    expect(swapped.res.status).toBe(400);
  });

  test("scores must be whole, non-negative numbers", async () => {
    const created = await create();
    for (const scoreA of [-1, 1.5, "2"]) {
      const { res } = await send("art", "PATCH", `/${created.id}`, { version: 1, scoreA });
      expect(res.status).toBe(400);
    }
  });

  test("delete needs the current version", async () => {
    const created = await create();
    expect((await send("art", "DELETE", `/${created.id}?version=2`)).res.status).toBe(409);
    expect((await send("art", "DELETE", `/${created.id}?version=1`)).res.status).toBe(200);
    const { body } = await send<{ items: Match[] }>("art", "GET", "/");
    expect(body.items).toEqual([]);
  });

  test("guests and signed-out visitors cannot edit", async () => {
    const created = await create();
    expect((await send("guest", "GET", "/")).res.status).toBe(403);
    expect(
      (await send("guest", "PATCH", `/${created.id}`, { version: 1, scoreA: 9 })).res.status,
    ).toBe(403);
    expect((await send(null, "GET", "/")).res.status).toBe(401);
  });
});

describe("public scoreboard", () => {
  test("anyone sees matches and standings from finished matches only", async () => {
    await create({ scoreA: 2, scoreB: 0, status: "finished" });
    await create({ teamA: "kmutnb", teamB: "kmitl", scoreA: 1, scoreB: 1, status: "finished" });
    await create({ teamA: "kmutnb", teamB: "kmutt", scoreA: 5, scoreB: 0, status: "live" });

    const res = await publicApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matches: Record<string, unknown>[];
      standings: { overall: { university: string; points: number }[] };
    };
    expect(body.matches).toHaveLength(3);
    expect(body.matches[0]).not.toHaveProperty("version");
    expect(body.matches[0]).not.toHaveProperty("updatedBy");
    expect(body.standings.overall.map((row) => [row.university, row.points])).toEqual([
      ["kmutt", 3],
      ["kmutnb", 1],
      ["kmitl", 1],
    ]);
  });
});
