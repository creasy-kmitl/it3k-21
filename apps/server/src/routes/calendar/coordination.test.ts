import { beforeEach, describe, expect, test } from "bun:test";
import { calendarChange, calendarItem } from "@it3k/db/schema/index";
import { eq, sql } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createCalendarRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCalendarRoutes>;
let sports: string;
let venue: string;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// 2026-10-10 13:00 Bangkok time.
const START = Date.UTC(2026, 9, 10, 6);

type Department = {
  id: string;
  name: string;
  state: string;
  request: string | null;
  response: string | null;
  canAnswer: boolean;
};
type ActionItem = {
  id: string;
  title: string;
  status: string;
  version: number;
  itemId: string;
  canComplete: boolean;
};
type Detail = {
  id: string;
  version: number;
  seriesId: string | null;
  pendingRequests: number;
  departments: Department[];
  actionItems: ActionItem[];
  decisions: { id: string; text: string }[];
  carriedOver: ActionItem[];
};

beforeEach(async () => {
  t = createTestContext();
  app = createCalendarRoutes(t.deps);
  sports = await t.departmentId("กีฬา");
  venue = await t.departmentId("สถานที่");
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("sports-staff", { department: "กีฬา", name: "Sports Staff" });
  await t.seedUser("sports-other", { department: "กีฬา", name: "Sports Other" });
  await t.seedUser("art-staff", { department: "Art", name: "Art Staff" });
  await t.seedUser("guest", { role: "guest" });
});

async function send<T = Record<string, unknown>>(
  userId: string | null,
  method: string,
  path: string,
  json?: unknown,
) {
  const res = await app.request(path, t.as(userId, { method, json }));
  const body = res.status === 204 ? {} : await readJson(res);
  return { res, body: body as T };
}

async function create(overrides: Record<string, unknown> = {}) {
  const { res, body } = await send<Detail>("tech-staff", "POST", "/items", {
    title: "ประชุมข้ามฝ่าย: ตารางแข่ง",
    mode: "coordination",
    category: "cross_team_meeting",
    status: "confirmed",
    startAt: START,
    endAt: START + HOUR,
    ownerId: "tech-staff",
    source: "Run sheet v1",
    departmentIds: [sports],
    ...overrides,
  });
  expect(res.status).toBe(201);
  return body;
}

const detail = async (itemId: string, who = "tech-staff") =>
  (await send<Detail>(who, "GET", `/items/${itemId}`)).body;

const requestPath = (itemId: string, departmentId = sports) =>
  `/items/${itemId}/departments/${departmentId}/request`;
const answerPath = (itemId: string, departmentId = sports) =>
  `/items/${itemId}/departments/${departmentId}/answer`;

async function actions(itemId: string) {
  return t.db
    .select({ action: calendarChange.action })
    .from(calendarChange)
    .where(eq(calendarChange.itemId, itemId))
    .orderBy(calendarChange.createdAt, sql`rowid`);
}

describe("access", () => {
  test("the coordination routes sit behind sign-in and membership", async () => {
    expect((await send(null, "GET", "/action-items")).res.status).toBe(401);
    expect((await send("guest", "GET", "/action-items")).res.status).toBe(403);
  });
});

describe("department requests", () => {
  test("Tech/Live asks, the department answers, and both are logged", async () => {
    const item = await create();
    expect(item.pendingRequests).toBe(0);
    const asked = await send("tech-staff", "PUT", requestPath(item.id), {
      request: "ขอตารางแข่งรอบรองชนะเลิศ",
      dueAt: START - DAY,
    });
    expect(asked.res.status).toBe(200);
    let seen = await detail(item.id, "sports-staff");
    expect(seen.pendingRequests).toBe(1);
    expect(seen.departments[0]).toMatchObject({ state: "requested", canAnswer: true });

    const answer = { response: "ส่งตารางในไดรฟ์แล้ว" };
    expect((await send("art-staff", "POST", answerPath(item.id), answer)).res.status).toBe(403);
    expect(
      (await send("sports-staff", "PUT", requestPath(item.id), { request: "x" })).res.status,
    ).toBe(403);
    expect((await send("sports-staff", "POST", answerPath(item.id), answer)).res.status).toBe(200);
    seen = await detail(item.id);
    expect(seen.pendingRequests).toBe(0);
    expect(seen.departments[0]).toMatchObject({
      state: "answered",
      response: "ส่งตารางในไดรฟ์แล้ว",
    });
    expect((await actions(item.id)).map((row) => row.action)).toEqual([
      "create",
      "request",
      "answer",
    ]);
  });

  test("a changed request needs a new answer; a withdrawn one needs none", async () => {
    const item = await create();
    await send("tech-staff", "PUT", requestPath(item.id), { request: "ขอตาราง" });
    await send("sports-staff", "POST", answerPath(item.id), { response: "ส่งแล้ว" });
    await send("tech-staff", "PUT", requestPath(item.id), { request: "ขอตาราง v2" });
    let seen = await detail(item.id);
    expect(seen.departments[0]).toMatchObject({ state: "requested", response: null });
    await send("tech-staff", "PUT", requestPath(item.id), { request: null });
    seen = await detail(item.id);
    expect(seen.departments[0]).toMatchObject({ state: "involved", canAnswer: false });
    const nothing = await send("sports-staff", "POST", answerPath(item.id), { response: "?" });
    expect(nothing.res.status).toBe(400);
  });

  test("only involved departments can be asked", async () => {
    const item = await create();
    const res = await send("tech-staff", "PUT", requestPath(item.id, venue), { request: "x" });
    expect(res.res.status).toBe(404);
  });

  test("editing the departments keeps the answers of those that stay", async () => {
    const item = await create();
    await send("tech-staff", "PUT", requestPath(item.id), { request: "ขอตาราง" });
    await send("sports-staff", "POST", answerPath(item.id), { response: "ส่งแล้ว" });
    await send("tech-staff", "PATCH", `/items/${item.id}`, {
      departmentIds: [sports, venue],
      version: 1,
    });
    const seen = await detail(item.id);
    const bySports = defined(
      seen.departments.find((d) => d.id === sports),
      "sports",
    );
    expect(bySports).toMatchObject({ state: "answered", response: "ส่งแล้ว" });
    expect(seen.departments).toHaveLength(2);
  });

  test("an answerer who left the department mid-request writes nothing", async () => {
    const item = await create();
    await send("tech-staff", "PUT", requestPath(item.id), { request: "ขอตาราง" });
    const art = await t.departmentId("Art");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE user SET department_id = ? WHERE id = 'sports-staff'", [art]);
    };
    const res = await send("sports-staff", "POST", answerPath(item.id), { response: "ส่งแล้ว" });
    expect(res.res.status).toBe(409);
    expect((await detail(item.id)).departments[0]?.state).toBe("requested");
  });
});

describe("action items", () => {
  test("assignees and their department tick items off; only editors change them", async () => {
    const item = await create();
    const { res, body: action } = await send<ActionItem>(
      "tech-staff",
      "POST",
      `/items/${item.id}/action-items`,
      { title: "ส่งรายชื่อทีม", ownerId: "sports-staff", departmentId: sports, dueAt: START },
    );
    expect(res.status).toBe(201);
    expect((await send("sports-staff", "GET", "/action-items")).body).toMatchObject({
      items: [{ id: action.id, title: "ส่งรายชื่อทีม", canComplete: true }],
    });

    const rename = { title: "อื่น", version: 1 };
    expect(
      (await send("sports-staff", "PATCH", `/action-items/${action.id}`, rename)).res.status,
    ).toBe(403);
    const done = { done: true, version: 1 };
    expect((await send("art-staff", "PATCH", `/action-items/${action.id}`, done)).res.status).toBe(
      403,
    );
    // Someone else in the assigned department may close it too.
    expect(
      (await send("sports-other", "PATCH", `/action-items/${action.id}`, done)).res.status,
    ).toBe(200);
    const [closed] = (await detail(item.id)).actionItems;
    expect(closed).toMatchObject({ status: "done", version: 2 });
    expect((await send("sports-staff", "GET", "/action-items")).body).toEqual({ items: [] });
    // An edit based on the old version is refused.
    expect(
      (await send("tech-staff", "PATCH", `/action-items/${action.id}`, rename)).res.status,
    ).toBe(409);
  });

  test("only editors add or remove action items and decisions", async () => {
    const item = await create();
    const add = { title: "x" };
    expect(
      (await send("sports-staff", "POST", `/items/${item.id}/action-items`, add)).res.status,
    ).toBe(403);
    expect(
      (await send("sports-staff", "POST", `/items/${item.id}/decisions`, { text: "x" })).res.status,
    ).toBe(403);
    await send("tech-staff", "POST", `/items/${item.id}/decisions`, { text: "ใช้ห้อง 301" });
    const [decision] = (await detail(item.id)).decisions;
    expect(decision?.text).toBe("ใช้ห้อง 301");
    const removed = await send("tech-staff", "DELETE", `/decisions/${decision?.id}`);
    expect(removed.res.status).toBe(204);
    expect((await detail(item.id)).decisions).toEqual([]);
  });
});

describe("closing meetings", () => {
  test("a meeting needs an agenda, departments and a record before it closes", async () => {
    const item = await create({ mode: "meetings", category: "planning", departmentIds: [] });
    const close = { status: "completed", version: 1 };
    const refused = await send<{ missing: string[] }>(
      "tech-staff",
      "PATCH",
      `/items/${item.id}`,
      close,
    );
    expect(refused.res.status).toBe(400);
    expect(refused.body.missing).toEqual(["agenda", "departments", "decision or action item"]);

    await send("tech-staff", "POST", `/items/${item.id}/decisions`, { text: "ปล่อยวันศุกร์" });
    const closed = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      ...close,
      agenda: "1. สถานะงาน",
      departmentIds: [await t.departmentId("Tech/Live")],
    });
    expect(closed.res.status).toBe(200);
  });

  test("a record deleted mid-request stops the meeting from closing", async () => {
    const item = await create({ agenda: "1. สถานะงาน" });
    await send("tech-staff", "POST", `/items/${item.id}/decisions`, { text: "ตกลง" });
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("DELETE FROM calendar_decision");
    };
    const res = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      status: "completed",
      version: 1,
    });
    expect(res.res.status).toBe(409);
  });

  test("matches close without a meeting record", async () => {
    const item = await create({ mode: "operations", category: "match", departmentIds: [] });
    const res = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      status: "completed",
      version: 1,
    });
    expect(res.res.status).toBe(200);
  });
});

describe("series", () => {
  test("creates a weekly series and carries open action items forward", async () => {
    const first = await create({
      mode: "meetings",
      category: "planning",
      repeat: { every: "week", count: 3 },
    });
    const rows = await t.db
      .select({
        id: calendarItem.id,
        startAt: calendarItem.startAt,
        seriesId: calendarItem.seriesId,
      })
      .from(calendarItem)
      .orderBy(calendarItem.startAt);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.seriesId)).size).toBe(1);
    expect(rows.map((row) => row.startAt.getTime() - START)).toEqual([0, 7 * DAY, 14 * DAY]);

    await send("tech-staff", "POST", `/items/${first.id}/action-items`, { title: "ตั้ง OBS" });
    const second = defined(rows[1], "second");
    expect((await detail(second.id)).carriedOver.map((action) => action.title)).toEqual(["ตั้ง OBS"]);
    expect((await detail(first.id)).carriedOver).toEqual([]);
  });

  test("refuses series longer than 26", async () => {
    const res = await send("tech-staff", "POST", "/items", {
      title: "sync",
      mode: "meetings",
      category: "planning",
      status: "confirmed",
      startAt: START,
      endAt: START + HOUR,
      ownerId: "tech-staff",
      source: "x",
      repeat: { every: "day", count: 27 },
    });
    expect(res.res.status).toBe(400);
  });

  test("a copy of a series item stands alone", async () => {
    const first = await create({ repeat: { every: "day", count: 2 } });
    const { body } = await send<Detail>("tech-staff", "POST", `/items/${first.id}/duplicate`, {});
    expect(body.seriesId).toBeNull();
  });
});
