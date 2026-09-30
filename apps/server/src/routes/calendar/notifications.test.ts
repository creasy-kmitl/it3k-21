import { beforeEach, describe, expect, test } from "bun:test";

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
};

beforeEach(async () => {
  t = createTestContext();
  app = createCalendarRoutes(t.deps);
  await t.seedUser("planner", { department: "กีฬา", name: "Planner" });
  await t.seedUser("owner", { department: "กีฬา", name: "Owner" });
  await t.seedUser("next-owner", { department: "กีฬา", name: "Next Owner" });
  await t.seedUser("reg-head", { department: "ทะเบียน", seat: "head", name: "Reg Head" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", name: "Reg Staff" });
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
  const { res, body } = await send<{ id: string; version: number }>("planner", "POST", "/items", {
    title: "ซ้อมพิธีเปิด",
    startAt: START,
    endAt: START + 2 * HOUR,
    ownerId: "owner",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return body;
}

describe("notifications", () => {
  test("the owner hears about an item; the actor does not", async () => {
    await create();
    expect((await inbox("owner")).items.map((n) => n.kind)).toEqual(["assignment"]);
    expect((await inbox("planner")).items).toEqual([]);
    await create({ ownerId: "planner" });
    expect((await inbox("planner")).items).toEqual([]);
  });

  test("a reschedule tells the owner when and why", async () => {
    const item = await create();
    await send("planner", "PATCH", `/items/${item.id}`, {
      startAt: START + HOUR,
      endAt: START + 3 * HOUR,
      reason: "สนามไม่ว่าง",
      version: 1,
    });
    expect((await inbox("owner")).items[0]).toMatchObject({
      kind: "reschedule",
      itemTitle: "ซ้อมพิธีเปิด",
      data: { startAt: START + HOUR, previousStartAt: START, reason: "สนามไม่ว่าง" },
    });
  });

  test("handing an item over tells the new owner, and a cancellation tells both", async () => {
    const item = await create();
    await send("planner", "PATCH", `/items/${item.id}`, { ownerId: "next-owner", version: 1 });
    expect((await inbox("next-owner")).items.map((n) => n.kind)).toEqual(["assignment"]);
    await send("planner", "PATCH", `/items/${item.id}`, {
      status: "cancelled",
      reason: "ฝนตก",
      version: 2,
    });
    expect((await inbox("next-owner")).items.map((n) => n.kind)).toEqual(["cancel", "assignment"]);
    // The previous owner only hears about changes while they own it.
    expect((await inbox("owner")).items.map((n) => n.kind)).toEqual(["assignment"]);
  });

  test("leaders of a collaborating department hear when it is added and when the item moves", async () => {
    const registration = await t.departmentId("ทะเบียน");
    const item = await create({ collaboratorIds: [registration] });
    expect((await inbox("reg-head")).items[0]).toMatchObject({
      kind: "collaboration",
      data: { department: "ทะเบียน", startAt: START },
    });
    // Only leaders are told, not every member.
    expect((await inbox("reg-staff")).items).toEqual([]);
    await send("planner", "PATCH", `/items/${item.id}`, {
      status: "cancelled",
      reason: "ฝนตก",
      version: 1,
    });
    expect((await inbox("reg-head")).items.map((n) => n.kind)).toEqual(["cancel", "collaboration"]);
  });

  test("marking read only touches the caller's own notifications", async () => {
    await create();
    const [notice] = (await inbox("owner")).items;
    await send("planner", "POST", "/notifications/read", { ids: [notice?.id] });
    expect((await inbox("owner")).unread).toBe(1);
    await send("owner", "POST", "/notifications/read", { all: true });
    expect((await inbox("owner")).unread).toBe(0);
  });
});
