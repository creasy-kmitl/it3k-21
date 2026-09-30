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
  nextCursor: string | null;
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

  test("viceheads hear too, each department's leaders once, and removal tells nobody", async () => {
    await t.seedUser("reg-vice", { department: "ทะเบียน", seat: "vicehead", name: "Reg Vice" });
    await t.seedUser("art-head", { department: "Art", seat: "head", name: "Art Head" });
    const registration = await t.departmentId("ทะเบียน");
    const art = await t.departmentId("Art");
    const item = await create({ collaboratorIds: [registration, art] });
    for (const leader of ["reg-head", "reg-vice"]) {
      expect((await inbox(leader)).items.map((n) => n.data.department)).toEqual(["ทะเบียน"]);
    }
    expect((await inbox("art-head")).items.map((n) => n.data.department)).toEqual(["Art"]);
    await send("planner", "PATCH", `/items/${item.id}`, { collaboratorIds: [art], version: 1 });
    expect((await inbox("reg-head")).items).toHaveLength(1);
    // A later reschedule reaches only departments still on the item.
    await send("planner", "PATCH", `/items/${item.id}`, {
      startAt: START + HOUR,
      endAt: START + 3 * HOUR,
      reason: "เลื่อน",
      version: 2,
    });
    expect((await inbox("reg-head")).items).toHaveLength(1);
    expect((await inbox("art-head")).items.map((n) => n.kind)).toEqual([
      "reschedule",
      "collaboration",
    ]);
  });

  test("an unchanged collaborator list sends nothing new", async () => {
    const registration = await t.departmentId("ทะเบียน");
    const item = await create({ collaboratorIds: [registration] });
    await send("planner", "PATCH", `/items/${item.id}`, {
      title: "เปลี่ยนชื่อ",
      collaboratorIds: [registration],
      version: 1,
    });
    expect((await inbox("reg-head")).items).toHaveLength(1);
  });

  test("the inbox is newest first and counts only unread", async () => {
    await create({ title: "หนึ่ง" });
    await create({ title: "สอง" });
    const box = await inbox("owner");
    expect(box.items.map((n) => n.itemTitle)).toEqual(["สอง", "หนึ่ง"]);
    await send("owner", "POST", "/notifications/read", { ids: [box.items[0]?.id] });
    expect((await inbox("owner")).unread).toBe(1);
    expect((await send("owner", "POST", "/notifications/read", { ids: [] })).res.status).toBe(400);
  });

  test("pages through every notice, so an old unread one can still be opened", async () => {
    const item = await create();
    await send("owner", "POST", "/notifications/read", { all: true });
    // 55 more, all in the same millisecond; the oldest is left unread.
    const at = Date.now() - 60_000;
    for (let i = 0; i < 55; i++) {
      t.sqlite.run(
        "INSERT INTO calendar_notification (id, user_id, item_id, kind, item_title, data, read_at, created_at) VALUES (?, 'owner', ?, 'assignment', ?, '{}', ?, ?)",
        [`n${String(i).padStart(2, "0")}`, item.id, `notice ${i}`, i === 0 ? null : at, at],
      );
    }
    const first = await inbox("owner");
    expect(first.unread).toBe(1);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const { body: second } = await send<Inbox>(
      "owner",
      "GET",
      `/notifications?cursor=${first.nextCursor}`,
    );
    const titles = [...first.items, ...second.items].map((n) => n.itemTitle);
    // Every notice exactly once, newest first, ending with the oldest.
    expect(new Set(titles).size).toBe(56);
    expect(titles.slice(0, 2)).toEqual(["ซ้อมพิธีเปิด", "notice 54"]);
    expect(titles.at(-1)).toBe("notice 0");
    expect(second.nextCursor).toBeNull();
    expect(second.items.at(-1)).toMatchObject({ itemTitle: "notice 0", readAt: null });
  });

  test("refuses a malformed cursor", async () => {
    for (const cursor of ["abc", "1", "1.2.3", "-1.2"]) {
      expect((await send("owner", "GET", `/notifications?cursor=${cursor}`)).res.status).toBe(400);
    }
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
