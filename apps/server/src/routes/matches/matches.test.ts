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
  durationMinutes: number | null;
  breaks: { atMinute: number; minutes: number }[];
  pausedAt: number | null;
  pausedMs: number;
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

const NEW_MATCH = {
  sport: "ฟุตบอล",
  teamA: "kmutt",
  teamB: "kmitl",
  // Far ahead, so the match is still waiting for its start time.
  startsAt: Date.UTC(2099, 10, 20, 3),
  durationMinutes: 90,
};

async function create(input: Record<string, unknown> = {}) {
  const { res, body } = await send<Match>("art", "POST", "/", { ...NEW_MATCH, ...input });
  expect(res.status).toBe(201);
  return body;
}

/** Creates a match, then records its score: new matches always start at 0 : 0. */
async function played(input: Record<string, unknown>, result: Record<string, unknown>) {
  const created = await create(input);
  const { res } = await send("art", "PATCH", `/${created.id}`, { version: 1, ...result });
  expect(res.status).toBe(200);
}

describe("matches", () => {
  test("a member records a match and corrects its score", async () => {
    const created = await create({ breaks: [{ atMinute: 45, minutes: 15 }] });
    expect(created).toMatchObject({
      scoreA: 0,
      scoreB: 0,
      status: "scheduled",
      durationMinutes: 90,
      breaks: [{ atMinute: 45, minutes: 15 }],
      version: 1,
    });

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

  test("a new match needs a start time and a length, and starts at 0 : 0", async () => {
    const { startsAt: _startsAt, ...noStart } = NEW_MATCH;
    const { durationMinutes: _duration, ...noLength } = NEW_MATCH;
    expect((await send("art", "POST", "/", noStart)).res.status).toBe(400);
    expect((await send("art", "POST", "/", noLength)).res.status).toBe(400);
    expect((await send("art", "POST", "/", { ...NEW_MATCH, durationMinutes: 0 })).res.status).toBe(
      400,
    );
    expect((await send("art", "POST", "/", { ...NEW_MATCH, scoreA: 3 })).res.status).toBe(400);
    expect((await create()).breaks).toEqual([]);
  });

  test("a match may have several breaks of different lengths", async () => {
    const breaks = [
      { atMinute: 10, minutes: 2 },
      { atMinute: 20, minutes: 15 },
      { atMinute: 30, minutes: 2 },
    ];
    const created = await create({ sport: "บาสเกตบอล", durationMinutes: 40, breaks });
    expect(created.breaks).toEqual(breaks);
  });

  test("every break needs both its minute and its length, inside the match, in order", async () => {
    for (const breaks of [
      [{ atMinute: 45 }],
      [{ minutes: 15 }],
      [{ atMinute: 90, minutes: 15 }],
      [{ atMinute: 45, minutes: 0 }],
      [
        { atMinute: 60, minutes: 5 },
        { atMinute: 30, minutes: 5 },
      ],
      [
        { atMinute: 30, minutes: 5 },
        { atMinute: 30, minutes: 5 },
      ],
    ]) {
      const { res } = await send("art", "POST", "/", { ...NEW_MATCH, breaks });
      expect(res.status).toBe(400);
    }
  });

  test("an emergency stop holds the clock, and carrying on adds the stop to the total", async () => {
    const created = await create({ status: "live" });
    expect(created).toMatchObject({ pausedAt: null, pausedMs: 0 });

    const stopped = await send<Match>("art", "PATCH", `/${created.id}`, {
      version: 1,
      paused: true,
    });
    expect(stopped.res.status).toBe(200);
    expect(stopped.body.status).toBe("live");
    expect(typeof stopped.body.pausedAt).toBe("number");

    // Saving a score while stopped leaves the stop running.
    const scored = await send<Match>("art", "PATCH", `/${created.id}`, { version: 2, scoreA: 1 });
    expect(scored.body.pausedAt).toBe(stopped.body.pausedAt);

    const resumed = await send<Match>("art", "PATCH", `/${created.id}`, {
      version: 3,
      paused: false,
    });
    expect(resumed.body.pausedAt).toBeNull();
    expect(resumed.body.pausedMs).toBeGreaterThanOrEqual(0);
  });

  test("a match goes live by itself once its start time has passed", async () => {
    const started = await create({ startsAt: Date.now() - 60_000 });
    expect(started.status).toBe("live");
    // It can be stopped straight away, and is saved as live from then on.
    const stopped = await send<Match>("art", "PATCH", `/${started.id}`, {
      version: 1,
      paused: true,
    });
    expect(stopped.body).toMatchObject({ status: "live" });
    expect(typeof stopped.body.pausedAt).toBe("number");
    expect((await create()).status).toBe("scheduled");
  });

  test("only a live match can stop, and finishing ends any stop", async () => {
    const scheduled = await create();
    const early = await send("art", "PATCH", `/${scheduled.id}`, { version: 1, paused: true });
    expect(early.res.status).toBe(400);

    const live = await create({ status: "live" });
    await send("art", "PATCH", `/${live.id}`, { version: 1, paused: true });
    const finished = await send<Match>("art", "PATCH", `/${live.id}`, {
      version: 2,
      status: "finished",
    });
    expect(finished.body).toMatchObject({ status: "finished", pausedAt: null });
  });

  test("an edit cannot leave a break outside the match", async () => {
    const created = await create({ breaks: [{ atMinute: 60, minutes: 15 }] });
    const shorter = await send("art", "PATCH", `/${created.id}`, {
      version: 1,
      durationMinutes: 50,
    });
    expect(shorter.res.status).toBe(400);
    const moved = await send<Match>("art", "PATCH", `/${created.id}`, {
      version: 1,
      durationMinutes: 50,
      breaks: [{ atMinute: 25, minutes: 10 }],
    });
    expect(moved.res.status).toBe(200);
    expect(moved.body).toMatchObject({ durationMinutes: 50, breaks: [{ atMinute: 25, minutes: 10 }] });
  });

  test("a match needs two different universities", async () => {
    const same = await send("art", "POST", "/", { ...NEW_MATCH, teamB: "kmutt" });
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
    await played({}, { scoreA: 2, scoreB: 0, status: "finished" });
    await played(
      { teamA: "kmutnb", teamB: "kmitl" },
      { scoreA: 1, scoreB: 1, status: "finished" },
    );
    await played({ teamA: "kmutnb", teamB: "kmutt" }, { scoreA: 5, scoreB: 0, status: "live" });

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
