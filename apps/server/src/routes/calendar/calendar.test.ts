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

describe("access and validation", () => {
  test("athletes and banned accounts are refused", async () => {
    await t.seedUser("athlete", { role: "athlete", department: "Art" });
    await t.seedUser("banned", { department: "Art", banned: true });
    for (const who of ["athlete", "banned"]) {
      expect((await send(who, "GET", range())).res.status).toBe(403);
      expect((await send(who, "POST", "/items", entry())).res.status).toBe(403);
    }
    expect((await send("guest", "GET", "/people")).res.status).toBe(403);
  });

  test("a member without a department reads but cannot add", async () => {
    await t.seedUser("floating", { name: "Floating" });
    expect((await send<Page>("floating", "GET", range())).body).toMatchObject({
      canCreate: false,
      myDepartmentId: null,
    });
    expect((await send("floating", "POST", "/items", entry())).res.status).toBe(400);
    expect((await send("floating", "GET", "/people")).res.status).toBe(403);
  });

  test("refuses backwards, too wide and malformed ranges", async () => {
    for (const path of [
      range(START, START),
      range(START, START + 63 * 24 * HOUR),
      "/items?from=abc&to=1",
      `${range()}&status=live`,
      `${range()}&departmentIds=${Array.from({ length: 31 }, (_, i) => `d${i}`).join(",")}`,
      `${range()}&unknown=1`,
    ]) {
      expect((await send("art-staff", "GET", path)).res.status).toBe(400);
    }
  });

  test("refuses bad item input", async () => {
    for (const body of [
      entry({ title: "   " }),
      entry({ title: "x".repeat(201) }),
      entry({ status: "live" }),
      entry({ visibility: "secret" }),
      entry({ startAt: 0 }),
      entry({ venue: "x".repeat(121) }),
      entry({ extra: true }),
      entry({ collaboratorIds: [registration, registration] }),
      entry({ collaboratorIds: Array.from({ length: 21 }, (_, i) => `d${i}`) }),
    ]) {
      expect((await send("art-staff", "POST", "/items", body)).res.status).toBe(400);
    }
  });

  test("POSTs must be JSON", async () => {
    const res = await app.request("/items", {
      ...t.as("art-staff", { method: "POST" }),
      body: "title=x",
      headers: { "x-test-user": "art-staff", "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
  });

  test("unknown and malformed ids", async () => {
    const missing = crypto.randomUUID();
    expect((await send("art-staff", "GET", `/items/${missing}`)).res.status).toBe(404);
    expect(
      (await send("art-staff", "PATCH", `/items/${missing}`, { title: "x", version: 1 })).res
        .status,
    ).toBe(404);
    expect((await send("art-staff", "DELETE", `/items/${missing}?version=1`)).res.status).toBe(404);
    expect((await send("art-staff", "GET", "/items/not-a-uuid")).res.status).toBe(400);
  });
});

describe("listing", () => {
  test("includes items spanning the window's edges and nothing outside it", async () => {
    await create({ title: "Across the start", startAt: START - 2 * HOUR, endAt: START + HOUR });
    await create({ title: "Before", startAt: START - 3 * HOUR, endAt: START - 2 * HOUR });
    await create({ title: "Inside", startAt: START + HOUR, endAt: START + 2 * HOUR });
    const { body } = await send<Page>("art-staff", "GET", range(START, START + 24 * HOUR));
    expect(body.items.map((item) => item.title)).toEqual(["Across the start", "Inside"]);
  });

  test("filters by status, owner and search text", async () => {
    await create({ title: "ร่างแผน", status: "draft" });
    await create({ title: "ติดตั้งฉาก", venue: "Hall 2", ownerId: "art-head" });
    await create({ title: "ยกเลิกแล้ว", status: "cancelled" });
    const titles = async (query: string) =>
      (await send<Page>("art-staff", "GET", `${range()}&${query}`)).body.items.map((i) => i.title);
    expect((await titles("status=draft,cancelled")).sort()).toEqual(["ยกเลิกแล้ว", "ร่างแผน"]);
    expect(await titles("ownerId=art-head")).toEqual(["ติดตั้งฉาก"]);
    expect(await titles("q=Hall")).toEqual(["ติดตั้งฉาก"]);
    expect(await titles(`q=${encodeURIComponent("Art Head")}`)).toEqual(["ติดตั้งฉาก"]);
    expect(await titles(`q=${encodeURIComponent("ร่าง")}`)).toEqual(["ร่างแผน"]);
  });

  test("lists an item owned by one chosen department and shared with another once", async () => {
    const item = await create({ collaboratorIds: [registration] });
    const { body } = await send<Page>(
      "reg-staff",
      "GET",
      `${range()}&departmentIds=${art},${registration}`,
    );
    expect(body.items.map((i) => i.id)).toEqual([item.id]);
  });
});

describe("more editing rules", () => {
  test("an edit that changes nothing saves nothing", async () => {
    const item = await create({ venue: "Hall" });
    const { res, body } = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      title: item.title,
      venue: "Hall",
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(body.version).toBe(1);
    expect(await changesOf(item.id)).toHaveLength(1);
    expect((await send("art-staff", "PATCH", `/items/${item.id}`, { version: 1 })).res.status).toBe(
      400,
    );
  });

  test("confirming a draft is logged as a status change and needs no reason", async () => {
    const item = await create({ status: "draft" });
    const { body } = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      status: "confirmed",
      version: 1,
    });
    expect(body.status).toBe("confirmed");
    expect((await changesOf(item.id)).at(-1)?.action).toBe("status");
    const draft = await create({ status: "draft" });
    const cancelled = await send("art-staff", "PATCH", `/items/${draft.id}`, {
      status: "cancelled",
      version: 1,
    });
    expect(cancelled.res.status).toBe(200);
  });

  test("the reason is kept in the change log", async () => {
    const item = await create();
    await send("art-staff", "PATCH", `/items/${item.id}`, {
      startAt: START + HOUR,
      endAt: START + 2 * HOUR,
      reason: "ห้องไม่ว่าง",
      version: 1,
    });
    expect((await changesOf(item.id)).at(-1)).toMatchObject({
      action: "reschedule",
      reason: "ห้องไม่ว่าง",
      changes: { startAt: [START, START + HOUR] },
    });
  });

  test("moving to an unknown department is refused", async () => {
    const item = await create();
    const { res } = await send("admin", "PATCH", `/items/${item.id}`, {
      departmentId: "no-such-department",
      version: 1,
    });
    expect(res.status).toBe(400);
  });

  test("records who acted for an impersonating admin", async () => {
    const res = await app.request("/items", {
      method: "POST",
      headers: {
        "x-test-user": "art-staff",
        "x-test-impersonated-by": "admin",
        "content-type": "application/json",
      },
      body: JSON.stringify(entry()),
    });
    const item = (await readJson(res)) as unknown as Item;
    expect((await changesOf(item.id))[0]).toMatchObject({
      actorUserId: "art-staff",
      impersonatedBy: "admin",
    });
  });
});

describe("more publishing rules", () => {
  test("a vicehead and an admin publish; admins publish any department's items", async () => {
    await t.seedUser("art-vice", { department: "Art", seat: "vicehead", name: "Art Vice" });
    const item = await create();
    expect(
      (
        await send<Item>("art-vice", "PATCH", `/items/${item.id}`, {
          visibility: "public",
          version: 1,
        })
      ).body.visibility,
    ).toBe("public");
    const reg = await create({ departmentId: registration, visibility: "public" }, "admin");
    expect(reg).toMatchObject({ visibility: "public", approvedAt: expect.any(Number) });
  });

  test("only publishers take an item off the public calendar by hand", async () => {
    const item = await create({ visibility: "public" }, "art-head");
    expect(
      (
        await send("art-staff", "PATCH", `/items/${item.id}`, {
          visibility: "internal",
          version: 1,
        })
      ).res.status,
    ).toBe(403);
    const { body } = await send<Item>("art-head", "PATCH", `/items/${item.id}`, {
      visibility: "internal",
      version: 1,
    });
    expect(body).toMatchObject({ visibility: "internal", approvedAt: null });
  });

  test("a member may edit a public item's details without unpublishing it", async () => {
    const item = await create({ visibility: "public" }, "art-head");
    const { body } = await send<Item>("art-staff", "PATCH", `/items/${item.id}`, {
      venue: "Hall 3",
      version: 1,
    });
    expect(body).toMatchObject({ venue: "Hall 3", visibility: "public" });
  });

  test("a public item cannot become a draft by hand while staying public", async () => {
    const item = await create({ visibility: "public" }, "art-head");
    const { res } = await send("art-head", "PATCH", `/items/${item.id}`, {
      status: "draft",
      visibility: "public",
      version: 1,
    });
    expect(res.status).toBe(400);
  });
});

describe("more races", () => {
  test("an admin who lost the role mid-request cannot move an item", async () => {
    const item = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE user SET role = 'staff' WHERE id = 'admin'");
    };
    const { res } = await send("admin", "PATCH", `/items/${item.id}`, {
      departmentId: registration,
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.departmentId).toBe(art);
  });

  test("an editor moved out of the department mid-delete deletes nothing", async () => {
    const item = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE user SET department_id = ? WHERE id = 'art-staff'", [registration]);
    };
    const { res } = await send("art-staff", "DELETE", `/items/${item.id}?version=1`);
    expect(res.status).toBe(409);
    expect(await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id))).toHaveLength(
      1,
    );
    expect(await changesOf(item.id)).toHaveLength(1);
  });

  test("an editor banned mid-create writes nothing", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE user SET banned = 1 WHERE id = 'art-staff'");
    };
    expect((await send("art-staff", "POST", "/items", entry())).res.status).toBe(409);
    expect(await t.db.select().from(calendarItem)).toEqual([]);
  });

  test("a collaborator department deleted mid-request fails cleanly", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("DELETE FROM department WHERE id = ?", [registration]);
    };
    const { res } = await send(
      "art-staff",
      "POST",
      "/items",
      entry({ collaboratorIds: [registration] }),
    );
    expect(res.status).toBe(409);
    expect(await t.db.select().from(calendarItem)).toEqual([]);
  });
});
