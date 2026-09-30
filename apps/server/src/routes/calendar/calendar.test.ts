import { beforeEach, describe, expect, test } from "bun:test";
import { calendarChange, calendarItem, leadership } from "@it3k/db/schema/index";
import { eq, sql } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { createCalendarRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCalendarRoutes>;

const HOUR = 60 * 60 * 1000;
// 2026-10-10 13:00 Bangkok time.
const START = Date.UTC(2026, 9, 10, 6);

type Item = {
  id: string;
  title: string;
  status: string;
  startAt: number;
  endAt: number;
  visibility: string;
  approvedAt: number | null;
  version: number;
  department: { id: string; name: string; icon: string; color: string };
  collaborators: { id: string; name: string }[];
  owner: { id: string; name: string } | null;
  venue: string | null;
  notes: string | null;
  canEdit: boolean;
  canPublish: boolean;
};

type Page = {
  items: Item[];
  canCreate: boolean;
  myDepartmentId: string | null;
  isAdmin: boolean;
};

let art = "";
let registration = "";

beforeEach(async () => {
  t = createTestContext();
  app = createCalendarRoutes(t.deps);
  art = await t.departmentId("Art");
  registration = await t.departmentId("ทะเบียน");
  await t.seedUser("admin", { role: "admin", name: "Admin" });
  await t.seedUser("art-staff", { department: "Art", name: "Art Staff" });
  await t.seedUser("art-head", { department: "Art", seat: "head", name: "Art Head" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", name: "Reg Staff" });
  await t.seedUser("guest", { role: "guest", name: "New Guest" });
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

const entry = (overrides: Record<string, unknown> = {}) => ({
  title: "ประชุมออกแบบฉาก",
  startAt: START,
  endAt: START + 2 * HOUR,
  ...overrides,
});

async function create(overrides: Record<string, unknown> = {}, who = "art-staff") {
  const { res, body } = await send<Item>(who, "POST", "/items", entry(overrides));
  expect(res.status).toBe(201);
  return body;
}

const range = (from = START - 24 * HOUR, to = START + 24 * HOUR) => `/items?from=${from}&to=${to}`;

async function changesOf(itemId: string) {
  return t.db
    .select()
    .from(calendarChange)
    .where(eq(calendarChange.itemId, itemId))
    .orderBy(calendarChange.createdAt, sql`rowid`);
}

describe("reading", () => {
  test("every member reads every department; guests are refused", async () => {
    await create({ title: "Art" });
    await create({ title: "Reg" }, "reg-staff");
    for (const who of ["admin", "art-staff", "reg-staff"]) {
      const { res, body } = await send<Page>(who, "GET", range());
      expect(res.status).toBe(200);
      expect(body.items.map((item) => item.title).sort()).toEqual(["Art", "Reg"]);
    }
    expect((await send("guest", "GET", range())).res.status).toBe(403);
  });

  test("filters by department", async () => {
    await create({ title: "Art" });
    await create({ title: "Reg" }, "reg-staff");
    const { body } = await send<Page>("art-staff", "GET", `${range()}&departmentIds=${art}`);
    expect(body.items.map((item) => item.title)).toEqual(["Art"]);
    const both = await send<Page>(
      "art-staff",
      "GET",
      `${range()}&departmentIds=${art},${registration}`,
    );
    expect(both.body.items).toHaveLength(2);
  });

  test("reports the viewer's department and what they may do", async () => {
    await create();
    const own = await send<Page>("art-staff", "GET", range());
    expect(own.body).toMatchObject({
      canCreate: true,
      myDepartmentId: art,
      isAdmin: false,
      canPublishOwn: false,
    });
    expect(own.body.items[0]).toMatchObject({ canEdit: true, canPublish: false });
    const head = await send<Page>("art-head", "GET", range());
    expect(head.body).toMatchObject({ canPublishOwn: true });
    expect(head.body.items[0]).toMatchObject({ canEdit: true, canPublish: true });
    expect((await send<Page>("reg-staff", "GET", range())).body.items[0]).toMatchObject({
      canEdit: false,
      canPublish: false,
    });
    expect((await send<Page>("admin", "GET", range())).body).toMatchObject({
      canCreate: true,
      myDepartmentId: null,
      isAdmin: true,
    });
  });

  test("the owner picker never exposes emails", async () => {
    const { body } = await send<{ items: { id: string }[] }>("art-staff", "GET", "/people?q=Art");
    expect(body.items.map((person) => person.id).sort()).toEqual(["art-head", "art-staff"]);
    expect(JSON.stringify(body)).not.toContain("@");
  });

  test("an item's detail includes its change log", async () => {
    const item = await create();
    const { body } = await send<{ changes: { action: string }[] }>(
      "reg-staff",
      "GET",
      `/items/${item.id}`,
    );
    expect(body.changes.map((change) => change.action)).toEqual(["create"]);
  });
});

describe("creating", () => {
  test("needs only a title and times, and defaults to the creator's department", async () => {
    const item = await create();
    expect(item).toMatchObject({
      status: "confirmed",
      visibility: "internal",
      department: { id: art, name: "Art" },
      owner: null,
      venue: null,
      notes: null,
    });
  });

  test("keeps the optional details", async () => {
    const item = await create({
      status: "draft",
      venue: "ห้อง 301",
      notes: "เตรียมโปรเจกเตอร์",
      ownerId: "art-head",
    });
    expect(item).toMatchObject({
      status: "draft",
      venue: "ห้อง 301",
      notes: "เตรียมโปรเจกเตอร์",
      owner: { id: "art-head", name: "Art Head" },
    });
  });

  test("members add only to their own department; admins to any", async () => {
    const { res } = await send(
      "art-staff",
      "POST",
      "/items",
      entry({ departmentId: registration }),
    );
    expect(res.status).toBe(403);
    const item = await create({ departmentId: registration }, "admin");
    expect(item.department.id).toBe(registration);
  });

  test("an admin without a department must choose one", async () => {
    expect((await send("admin", "POST", "/items", entry())).res.status).toBe(400);
  });

  test("refuses bad times and unknown owners", async () => {
    expect((await send("art-staff", "POST", "/items", entry({ endAt: START }))).res.status).toBe(
      400,
    );
    expect(
      (await send("art-staff", "POST", "/items", entry({ endAt: START + 32 * 24 * HOUR }))).res
        .status,
    ).toBe(400);
    expect(
      (await send("art-staff", "POST", "/items", entry({ ownerId: "guest" }))).res.status,
    ).toBe(400);
  });

  test("tells the owner", async () => {
    const item = await create({ ownerId: "art-head" });
    const { body } = await send<{ items: { kind: string; itemId: string }[] }>(
      "art-head",
      "GET",
      "/notifications",
    );
    expect(body.items).toEqual([expect.objectContaining({ kind: "assignment", itemId: item.id })]);
  });
});

describe("editing", () => {
  test("members edit their own department's items only", async () => {
    const item = await create();
    const other = await send("reg-staff", "PATCH", `/items/${item.id}`, {
      title: "Hijack",
      version: 1,
    });
    expect(other.res.status).toBe(403);
    const { res, body } = await send<Item>("art-head", "PATCH", `/items/${item.id}`, {
      title: "Renamed",
      venue: "Hall",
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ title: "Renamed", venue: "Hall", version: 2 });
    const [, change] = await changesOf(item.id);
    expect(change).toMatchObject({
      action: "update",
      actorUserId: "art-head",
      changes: { title: ["ประชุมออกแบบฉาก", "Renamed"], venue: [null, "Hall"] },
    });
  });

  test("clears optional details", async () => {
    const item = await create({ venue: "Hall", ownerId: "art-head" });
    const { body } = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      venue: "",
      ownerId: null,
      version: 1,
    });
    expect(body).toMatchObject({ venue: null, owner: null });
  });

  test("only admins move an item to another department", async () => {
    const item = await create();
    const { res } = await send("art-head", "PATCH", `/items/${item.id}`, {
      departmentId: registration,
      version: 1,
    });
    expect(res.status).toBe(403);
    const moved = await send<Item>("admin", "PATCH", `/items/${item.id}`, {
      departmentId: registration,
      version: 1,
    });
    expect(moved.body.department.id).toBe(registration);
  });

  test("a confirmed item needs a reason to move or be cancelled; a draft does not", async () => {
    const item = await create({ ownerId: "art-head" });
    const later = { startAt: START + 3 * HOUR, endAt: START + 4 * HOUR, version: 1 };
    expect((await send("art-staff", "PATCH", `/items/${item.id}`, later)).res.status).toBe(400);
    const { res } = await send("art-staff", "PATCH", `/items/${item.id}`, {
      ...later,
      reason: "ห้องไม่ว่าง",
    });
    expect(res.status).toBe(200);
    const cancelled = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      status: "cancelled",
      reason: "ยกเลิกงาน",
      version: 2,
    });
    expect(cancelled.body.status).toBe("cancelled");
    expect((await changesOf(item.id)).map((change) => change.action)).toEqual([
      "create",
      "reschedule",
      "cancel",
    ]);
    const { body } = await send<{ items: { kind: string }[] }>("art-head", "GET", "/notifications");
    expect(body.items.map((notice) => notice.kind)).toEqual(["cancel", "reschedule", "assignment"]);

    const draft = await create({ status: "draft" });
    expect((await send("art-staff", "PATCH", `/items/${draft.id}`, later)).res.status).toBe(200);
  });

  test("refuses an edit based on an old version", async () => {
    const item = await create();
    await send("art-staff", "PATCH", `/items/${item.id}`, { title: "First", version: 1 });
    const { res } = await send("art-staff", "PATCH", `/items/${item.id}`, {
      title: "Second",
      version: 1,
    });
    expect(res.status).toBe(409);
  });
});

describe("collaborating departments", () => {
  test("show the item on their calendar but cannot edit it", async () => {
    const item = await create({ collaboratorIds: [registration] });
    expect(item.collaborators).toEqual([
      expect.objectContaining({ id: registration, name: "ทะเบียน" }),
    ]);
    const { body } = await send<Page>(
      "reg-staff",
      "GET",
      `${range()}&departmentIds=${registration}`,
    );
    expect(body.items.map((i) => i.id)).toEqual([item.id]);
    expect(body.items[0]).toMatchObject({ canEdit: false });
    const edit = await send("reg-staff", "PATCH", `/items/${item.id}`, { title: "X", version: 1 });
    expect(edit.res.status).toBe(403);
  });

  test("the owning department adds and removes them, and the log says so", async () => {
    const item = await create();
    const { body } = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      collaboratorIds: [registration],
      version: 1,
    });
    expect(body.collaborators.map((d) => d.id)).toEqual([registration]);
    const cleared = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      collaboratorIds: [],
      version: 2,
    });
    expect(cleared.body.collaborators).toEqual([]);
    const [, added, dropped] = await changesOf(item.id);
    expect(added?.changes).toEqual({ collaboratorIds: [[], [registration]] });
    expect(dropped?.changes).toEqual({ collaboratorIds: [[registration], []] });
  });

  test("refuses the owning department and unknown departments", async () => {
    for (const ids of [[art], ["no-such-department"]]) {
      const { res } = await send("art-staff", "POST", "/items", entry({ collaboratorIds: ids }));
      expect(res.status).toBe(400);
    }
  });

  test("an item moved to a collaborator is owned by it, no longer shared with it", async () => {
    const item = await create({ collaboratorIds: [registration] });
    const { body } = await send<Item>("admin", "PATCH", `/items/${item.id}`, {
      departmentId: registration,
      version: 1,
    });
    expect(body.department.id).toBe(registration);
    expect(body.collaborators).toEqual([]);
  });

  test("a collaborator change based on an old version is refused", async () => {
    const item = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE calendar_item SET version = 2 WHERE id = ?", [item.id]);
    };
    const { res } = await send("art-staff", "PATCH", `/items/${item.id}`, {
      collaboratorIds: [registration],
      version: 1,
    });
    expect(res.status).toBe(409);
    expect((await send<Item>("art-staff", "GET", `/items/${item.id}`)).body.collaborators).toEqual(
      [],
    );
  });
});

describe("publishing", () => {
  test("the department's head publishes; members and other heads cannot", async () => {
    const item = await create();
    expect(
      (await send("art-staff", "PATCH", `/items/${item.id}`, { visibility: "public", version: 1 }))
        .res.status,
    ).toBe(403);
    const { body } = await send<Item>("art-head", "PATCH", `/items/${item.id}`, {
      visibility: "public",
      version: 1,
    });
    expect(body).toMatchObject({ visibility: "public", approvedAt: expect.any(Number) });
    expect((await changesOf(item.id)).at(-1)?.action).toBe("publish");
  });

  test("drafts cannot be public", async () => {
    const { res } = await send(
      "art-head",
      "POST",
      "/items",
      entry({ status: "draft", visibility: "public" }),
    );
    expect(res.status).toBe(400);
  });

  test("leaving confirmed takes an item off the public calendar", async () => {
    const item = await create({ visibility: "public" }, "art-head");
    const { body } = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      status: "cancelled",
      reason: "ยกเลิก",
      version: 1,
    });
    expect(body).toMatchObject({ status: "cancelled", visibility: "internal", approvedAt: null });
  });
});

describe("deleting", () => {
  test("removes the item and keeps its history", async () => {
    const item = await create();
    expect((await send("reg-staff", "DELETE", `/items/${item.id}?version=1`)).res.status).toBe(403);
    expect((await send("art-staff", "DELETE", `/items/${item.id}?version=2`)).res.status).toBe(409);
    expect((await send("art-staff", "DELETE", `/items/${item.id}?version=1`)).res.status).toBe(200);
    expect(await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id))).toEqual([]);
    expect((await changesOf(item.id)).map((change) => change.action)).toEqual(["create", "delete"]);
  });
});

describe("races", () => {
  test("an editor moved out of the department mid-request writes nothing", async () => {
    const item = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE user SET department_id = ? WHERE id = 'art-staff'", [registration]);
    };
    const { res } = await send("art-staff", "PATCH", `/items/${item.id}`, {
      title: "Changed",
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row).toMatchObject({ title: item.title, version: 1 });
    expect(await changesOf(item.id)).toHaveLength(1);
  });

  test("a head who lost the seat mid-request cannot publish", async () => {
    const item = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("DELETE FROM leadership WHERE user_id = 'art-head'");
    };
    const { res } = await send("art-head", "PATCH", `/items/${item.id}`, {
      visibility: "public",
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.visibility).toBe("internal");
    expect(await t.db.select().from(leadership).where(eq(leadership.userId, "art-head"))).toEqual(
      [],
    );
  });

  test("an edit saved by someone else mid-request wins", async () => {
    const item = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE calendar_item SET version = 2, title = 'Other' WHERE id = ?", [item.id]);
    };
    const { res } = await send("art-staff", "PATCH", `/items/${item.id}`, {
      title: "Mine",
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.title).toBe("Other");
  });
});
