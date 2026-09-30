import { beforeEach, describe, expect, test } from "bun:test";
import { LIVE_CHECKLIST } from "@it3k/db/calendar-rules";

import { createTestContext, readJson } from "../../testing";
import { createCalendarRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCalendarRoutes>;

const HOUR = 60 * 60 * 1000;
// 2026-10-10 13:00 Bangkok time.
const START = Date.UTC(2026, 9, 10, 6);

type Inbox = {
  unread: number;
  items: { id: string; kind: string; itemTitle: string; data: Record<string, unknown> }[];
  attention: { kind: string; itemTitle: string; checklistDone?: number; missing?: string[] }[];
};

beforeEach(async () => {
  t = createTestContext();
  app = createCalendarRoutes(t.deps);
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("oncall", { department: "Tech/Live", name: "On Call" });
  await t.seedUser("owner", { department: "Tech/Live", name: "Owner" });
  await t.seedUser("sports", { department: "กีฬา", name: "Sports" });
});

async function send<T = Record<string, unknown>>(
  userId: string,
  method: string,
  path: string,
  json?: unknown,
) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

const inbox = async (who: string) => (await send<Inbox>(who, "GET", "/notifications")).body;

async function create(overrides: Record<string, unknown> = {}) {
  const { res, body } = await send<{ id: string; version: number }>(
    "tech-staff",
    "POST",
    "/items",
    {
      title: "VALORANT SF",
      mode: "operations",
      category: "match",
      status: "confirmed",
      startAt: START,
      endAt: START + 2 * HOUR,
      ownerId: "owner",
      onCallOwnerId: "oncall",
      source: "Sports",
      ...overrides,
    },
  );
  expect(res.status).toBe(201);
  return body;
}

describe("notifications", () => {
  test("people given an item hear about it; the actor does not", async () => {
    await create();
    expect((await inbox("owner")).items.map((n) => n.kind)).toEqual(["assignment"]);
    expect((await inbox("oncall")).unread).toBe(1);
    expect((await inbox("tech-staff")).items).toEqual([]);
  });

  test("a reschedule tells everyone on the item and those waiting on it", async () => {
    const match = await create();
    const downstream = await create({
      title: "Result publish",
      category: "result_update",
      ownerId: "tech-staff",
      onCallOwnerId: null,
      startAt: START + 3 * HOUR,
      endAt: START + 4 * HOUR,
    });
    await send("tech-staff", "POST", `/items/${downstream.id}/dependencies`, {
      dependsOnId: match.id,
    });
    // The downstream owner is someone else, so they hear about it.
    await send("tech-staff", "PATCH", `/items/${downstream.id}`, {
      ownerId: "sports",
      version: 1,
    });
    await send("tech-staff", "PATCH", `/items/${match.id}`, {
      startAt: START + HOUR,
      endAt: START + 3 * HOUR,
      reason: "เลื่อนรอบ",
      version: 1,
      acceptConflicts: true,
      mitigation: "ok",
    });
    const owner = await inbox("owner");
    expect(owner.items[0]).toMatchObject({
      kind: "reschedule",
      itemTitle: "VALORANT SF",
      data: { startAt: START + HOUR, previousStartAt: START, reason: "เลื่อนรอบ" },
    });
    expect((await inbox("sports")).items.map((n) => n.kind)).toEqual(["dependency", "assignment"]);
  });

  test("request contacts and action item owners are told", async () => {
    const sports = await t.departmentId("กีฬา");
    const meeting = await create({
      mode: "coordination",
      category: "cross_team_meeting",
      onCallOwnerId: null,
      departmentIds: [sports],
    });
    await send("tech-staff", "PUT", `/items/${meeting.id}/departments/${sports}/request`, {
      request: "ขอตารางแข่ง",
      contactUserId: "sports",
    });
    await send("tech-staff", "POST", `/items/${meeting.id}/action-items`, {
      title: "ส่งรายชื่อทีม",
      ownerId: "sports",
    });
    const kinds = (await inbox("sports")).items.map((n) => n.kind);
    expect(kinds).toEqual(["action_item", "request"]);
  });

  test("marking read only touches the caller's own notifications", async () => {
    await create();
    const [notice] = (await inbox("owner")).items;
    await send("oncall", "POST", "/notifications/read", { ids: [notice?.id] });
    expect((await inbox("owner")).unread).toBe(1);
    await send("owner", "POST", "/notifications/read", { all: true });
    expect((await inbox("owner")).unread).toBe(0);
  });

  test("a withdrawn release approval is flagged as a release risk", async () => {
    await t.seedUser("tech-head", { department: "Tech/Live", seat: "head", name: "Tech Head" });
    const release = await create({
      title: "Scoreboard v2",
      mode: "delivery",
      category: "release",
      status: "ready_to_release",
      onCallOwnerId: null,
      environment: "prod",
      startAt: START + 5 * HOUR,
      endAt: START + 6 * HOUR,
    });
    await send("tech-head", "PATCH", `/items/${release.id}`, { releaseApproved: true, version: 1 });
    await send("tech-staff", "PATCH", `/items/${release.id}`, {
      rollbackPlan: "Revert",
      version: 2,
    });
    expect((await inbox("owner")).items[0]).toMatchObject({
      kind: "release_risk",
      data: { approvalWithdrawn: true },
    });
  });
});

describe("attention", () => {
  test("warns about my live blocks in the next day that are not ready", async () => {
    const soon = Math.floor(Date.now() / HOUR) * HOUR + 3 * HOUR;
    const item = await create({ startAt: soon, endAt: soon + HOUR });
    for (const key of LIVE_CHECKLIST.slice(0, 5)) {
      await send("tech-staff", "PUT", `/items/${item.id}/checklist/${key}`, { checked: true });
    }
    const { attention } = await inbox("oncall");
    expect(attention).toEqual([
      expect.objectContaining({ kind: "readiness", itemTitle: "VALORANT SF", checklistDone: 5 }),
    ]);
    expect((await inbox("sports")).attention).toEqual([]);
  });
});
