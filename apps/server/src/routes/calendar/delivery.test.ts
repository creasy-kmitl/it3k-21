import { beforeEach, describe, expect, test } from "bun:test";
import { calendarChange, calendarDependency, calendarItem } from "@it3k/db/schema/index";
import { eq, sql } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createCalendarRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCalendarRoutes>;

const HOUR = 60 * 60 * 1000;
// 2026-10-10 13:00 Bangkok time.
const START = Date.UTC(2026, 9, 10, 6);

type Link = {
  id: string;
  impact: string | null;
  satisfied: boolean;
  item: { id: string; title: string; status: string };
};
type Item = {
  id: string;
  version: number;
  status: string;
  riskLevel: string | null;
  waitingOn: number;
  releaseApprovedAt: number | null;
  monitoringOwner: { id: string; name: string } | null;
  dependsOn?: Link[];
  blocks?: Link[];
};

beforeEach(async () => {
  t = createTestContext();
  app = createCalendarRoutes(t.deps);
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("tech-head", { department: "Tech/Live", seat: "head", name: "Tech Head" });
  await t.seedUser("monitor", { department: "Tech/Live", name: "Monitor" });
  await t.seedUser("art-staff", { department: "Art", name: "Art Staff" });
});

async function send<T = Record<string, unknown>>(
  userId: string,
  method: string,
  path: string,
  json?: unknown,
) {
  const res = await app.request(path, t.as(userId, { method, json }));
  const body = res.status === 204 ? {} : await readJson(res);
  return { res, body: body as T };
}

const release = (overrides: Record<string, unknown> = {}) => ({
  title: "Scoreboard v2",
  mode: "delivery",
  category: "release",
  status: "ready_to_release",
  startAt: START,
  endAt: START + HOUR,
  ownerId: "tech-staff",
  source: "Roadmap",
  environment: "prod",
  feature: "Live scoreboard",
  ...overrides,
});

async function create(body: Record<string, unknown>, who = "tech-staff") {
  const { res, body: item } = await send<Item>(who, "POST", "/items", body);
  expect(res.status).toBe(201);
  return item;
}

const patch = (who: string, item: { id: string }, json: Record<string, unknown>) =>
  send<Item & { missing?: string[] }>(who, "PATCH", `/items/${item.id}`, json);

const detail = async (itemId: string) =>
  (await send<Item>("tech-staff", "GET", `/items/${itemId}`)).body;

describe("release gate", () => {
  test("needs QA, approval, a rollback plan and a monitoring owner", async () => {
    const item = await create(release());
    const refused = await patch("tech-staff", item, { status: "released", version: 1 });
    expect(refused.res.status).toBe(400);
    expect(refused.body.missing).toEqual(["qa", "approval", "rollbackPlan", "monitoringOwner"]);

    await patch("tech-staff", item, {
      qaResult: "passed",
      rollbackPlan: "Revert to v1 via Alchemy",
      monitoringOwnerId: "monitor",
      version: 1,
    });
    expect(
      (await patch("tech-staff", item, { releaseApproved: true, version: 2 })).res.status,
    ).toBe(403);
    const approved = await patch("tech-head", item, { releaseApproved: true, version: 2 });
    expect(approved.res.status).toBe(200);
    expect(approved.body.releaseApprovedAt).not.toBeNull();

    const released = await patch("tech-staff", item, { status: "released", version: 3 });
    expect(released.res.status).toBe(200);
    const changes = await t.db
      .select({ action: calendarChange.action })
      .from(calendarChange)
      .where(eq(calendarChange.itemId, item.id))
      .orderBy(calendarChange.createdAt, sql`rowid`);
    expect(changes.map((row) => row.action)).toContain("release_approval");
  });

  test("a release creates a monitoring item that follows it", async () => {
    const item = await create(
      release({ qaResult: "passed", rollbackPlan: "Revert", monitoringOwnerId: "monitor" }),
    );
    await patch("tech-head", item, { releaseApproved: true, version: 1 });
    await patch("tech-staff", item, { status: "released", version: 2 });
    const [monitoring] = await t.db
      .select()
      .from(calendarItem)
      .where(eq(calendarItem.category, "monitoring"));
    expect(monitoring).toMatchObject({
      title: "Monitor: Scoreboard v2",
      ownerId: "monitor",
      status: "in_progress",
      environment: "prod",
    });
    expect(defined(monitoring, "monitoring").startAt.getTime()).toBeGreaterThanOrEqual(
      START + HOUR,
    );
    const { body } = await send<Item>("tech-staff", "GET", `/items/${monitoring?.id}`);
    expect(body.dependsOn?.map((link) => link.item.id)).toEqual([item.id]);
    expect((await detail(item.id)).blocks?.map((link) => link.item.title)).toEqual([
      "Monitor: Scoreboard v2",
    ]);
  });

  test("changing the plan withdraws the approval", async () => {
    const item = await create(release());
    await patch("tech-head", item, { releaseApproved: true, version: 1 });
    const moved = await patch("tech-staff", item, {
      startAt: START + 2 * HOUR,
      endAt: START + 3 * HOUR,
      reason: "เลื่อนหลังแมตช์",
      version: 2,
    });
    expect(moved.body.releaseApprovedAt).toBeNull();
    const renamed = await patch("tech-head", item, { releaseApproved: true, version: 3 });
    expect(renamed.body.releaseApprovedAt).not.toBeNull();
    // Editing something outside the plan keeps it.
    const noted = await patch("tech-staff", item, { notes: "โน้ต", version: 4 });
    expect(noted.body.releaseApprovedAt).not.toBeNull();
  });

  test("releases go to preview, staging or prod, and start unreleased", async () => {
    expect(
      (await send("tech-staff", "POST", "/items", release({ environment: "qa" }))).res.status,
    ).toBe(400);
    expect(
      (await send("tech-staff", "POST", "/items", release({ status: "released" }))).res.status,
    ).toBe(400);
    const notRelease = await create(release({ category: "development", status: "in_progress" }));
    expect(
      (await patch("tech-head", notRelease, { releaseApproved: true, version: 1 })).res.status,
    ).toBe(400);
  });
});

describe("dependencies", () => {
  test("an unfinished dependency blocks the release until it is done", async () => {
    const qa = await create(release({ title: "QA scoreboard", category: "qa", status: "qa" }));
    const item = await create(
      release({
        startAt: START + 2 * HOUR,
        endAt: START + 3 * HOUR,
        qaResult: "passed",
        rollbackPlan: "Revert",
        monitoringOwnerId: "monitor",
      }),
    );
    const added = await send("tech-staff", "POST", `/items/${item.id}/dependencies`, {
      dependsOnId: qa.id,
      impact: "release window 16:00",
    });
    expect(added.res.status).toBe(201);
    expect((await detail(item.id)).waitingOn).toBe(1);
    await patch("tech-head", item, { releaseApproved: true, version: 1 });
    const blocked = await patch("tech-staff", item, { status: "released", version: 2 });
    expect(blocked.body.missing).toEqual(["dependencies"]);

    await patch("tech-staff", qa, { status: "ready_to_release", version: 1 });
    const seen = await detail(item.id);
    expect(seen.waitingOn).toBe(0);
    expect(seen.dependsOn?.[0]).toMatchObject({ satisfied: true, impact: "release window 16:00" });
    expect((await patch("tech-staff", item, { status: "released", version: 2 })).res.status).toBe(
      200,
    );
  });

  test("an upstream item reopened mid-request stops the release", async () => {
    const qa = await create(release({ title: "QA", category: "qa", status: "ready_to_release" }));
    const item = await create(
      release({
        startAt: START + 2 * HOUR,
        endAt: START + 3 * HOUR,
        qaResult: "passed",
        rollbackPlan: "Revert",
        monitoringOwnerId: "monitor",
      }),
    );
    await send("tech-staff", "POST", `/items/${item.id}/dependencies`, { dependsOnId: qa.id });
    await patch("tech-head", item, { releaseApproved: true, version: 1 });
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE calendar_item SET status = 'qa' WHERE id = ?", [qa.id]);
    };
    const res = await patch("tech-staff", item, { status: "released", version: 2 });
    expect(res.res.status).toBe(409);
    expect(
      await t.db.select().from(calendarItem).where(eq(calendarItem.category, "monitoring")),
    ).toEqual([]);
  });

  test("refuses cycles, duplicates, self-links and non-editors", async () => {
    const a = await create(release({ title: "A", category: "development", status: "planned" }));
    const b = await create(release({ title: "B", category: "development", status: "planned" }));
    const link = (from: string, to: string, who = "tech-staff") =>
      send(who, "POST", `/items/${from}/dependencies`, { dependsOnId: to });
    expect((await link(a.id, b.id, "art-staff")).res.status).toBe(403);
    expect((await link(a.id, a.id)).res.status).toBe(400);
    expect((await link(a.id, b.id)).res.status).toBe(201);
    expect((await link(a.id, b.id)).res.status).toBe(409);
    expect((await link(b.id, a.id)).res.status).toBe(400);

    const [dependency] = await t.db.select().from(calendarDependency);
    expect((await send("tech-staff", "DELETE", `/dependencies/${dependency?.id}`)).res.status).toBe(
      204,
    );
    expect((await link(b.id, a.id)).res.status).toBe(201);
  });

  test("the item picker finds items by title across any date", async () => {
    await create(
      release({
        title: "Overlay pack",
        startAt: START + 40 * 24 * HOUR,
        endAt: START + 40 * 24 * HOUR + HOUR,
      }),
    );
    const { body } = await send<{ items: { title: string }[] }>(
      "art-staff",
      "GET",
      "/search?q=overlay",
    );
    expect(body.items.map((item) => item.title)).toEqual(["Overlay pack"]);
  });
});

describe("release windows and live blocks", () => {
  test("warn both ways and mark an accepted release high risk", async () => {
    const match = await create({
      title: "VALORANT Final",
      mode: "operations",
      category: "match",
      status: "confirmed",
      startAt: START,
      endAt: START + 3 * HOUR,
      ownerId: "tech-head",
      source: "Sports",
    });
    const overlapping = release({ startAt: START + HOUR, endAt: START + 2 * HOUR });
    const warned = await send<{ conflicts: { id: string; kinds: string[] }[] }>(
      "tech-staff",
      "POST",
      "/items",
      overlapping,
    );
    expect(warned.res.status).toBe(422);
    expect(warned.body.conflicts).toEqual([
      expect.objectContaining({ id: match.id, kinds: ["release_window"] }),
    ]);
    const accepted = await create({
      ...overlapping,
      acceptConflicts: true,
      mitigation: "Hotfix เฉพาะ scoreboard ไม่แตะ stream",
    });
    expect(accepted.riskLevel).toBe("high");

    const laterMatch = await send("tech-staff", "POST", "/items", {
      title: "RoV Final",
      mode: "operations",
      category: "match",
      status: "confirmed",
      startAt: START + HOUR,
      endAt: START + 2 * HOUR,
      ownerId: "monitor",
      source: "Sports",
    });
    expect(laterMatch.res.status).toBe(422);
  });
});
