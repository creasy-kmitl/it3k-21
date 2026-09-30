import { beforeEach, describe, expect, test } from "bun:test";
import { calendarChange, calendarItem, leadership } from "@it3k/db/schema/index";
import { eq, sql } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
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
  version: number;
  tbd: boolean;
  lastConfirmedAt: number | null;
  departmentIds: string[];
  owner: { id: string; name: string } | null;
  canEdit: boolean;
};

beforeEach(async () => {
  t = createTestContext();
  app = createCalendarRoutes(t.deps);
  await t.seedUser("admin", { role: "admin", name: "Admin" });
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("tech-head", { department: "Tech/Live", seat: "head", name: "Tech Head" });
  await t.seedUser("art-staff", { department: "Art", name: "Art Staff" });
  await t.seedUser("art-head", { department: "Art", seat: "head", name: "Art Head" });
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

const match = (overrides: Record<string, unknown> = {}) => ({
  title: "VALORANT รอบรองชนะเลิศ",
  mode: "operations",
  category: "match",
  status: "draft",
  startAt: START,
  endAt: START + 2 * HOUR,
  ownerId: "tech-staff",
  source: "Sports schedule v1",
  game: "valorant",
  matchId: "VAL-SF1",
  teams: ["Team A", "Team B"],
  ...overrides,
});

async function create(overrides: Record<string, unknown> = {}, who = "tech-staff") {
  const { res, body } = await send<Item>(who, "POST", "/items", match(overrides));
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

describe("access", () => {
  test("every member reads; guests are refused", async () => {
    for (const who of ["admin", "tech-staff", "art-staff"]) {
      expect((await send(who, "GET", range())).res.status).toBe(200);
    }
    expect((await send("guest", "GET", range())).res.status).toBe(403);
  });

  test("only Tech/Live members and admins write", async () => {
    expect((await send("art-staff", "POST", "/items", match())).res.status).toBe(403);
    expect((await send("art-head", "POST", "/items", match())).res.status).toBe(403);
    await create({}, "tech-staff");
    // A later slot, so the two matches do not clash over the same owner.
    await create({ startAt: START + 3 * HOUR, endAt: START + 5 * HOUR }, "admin");
  });

  test("reports what the caller may do", async () => {
    expect((await send("tech-staff", "GET", range())).body).toMatchObject({
      canCreate: true,
      canApprove: false,
    });
    expect((await send("tech-head", "GET", range())).body).toMatchObject({
      canCreate: true,
      canApprove: true,
    });
    expect((await send("art-head", "GET", range())).body).toMatchObject({
      canCreate: false,
      canApprove: false,
    });
  });

  test("the owner picker is for editors and never exposes emails", async () => {
    expect((await send("art-staff", "GET", "/people")).res.status).toBe(403);
    const { body } = await send<{ items: { id: string }[] }>("tech-staff", "GET", "/people?q=Tech");
    expect(body.items.map((person) => person.id).sort()).toEqual(["tech-head", "tech-staff"]);
    expect(JSON.stringify(body)).not.toContain("@");
  });
});

describe("create", () => {
  test("stores the item as TBD until it is confirmed, and logs it", async () => {
    const item = await create({ departmentIds: [await t.departmentId("กีฬา")] });
    expect(item).toMatchObject({
      status: "draft",
      tbd: true,
      visibility: "internal",
      version: 1,
      owner: { id: "tech-staff", name: "Tech Staff" },
      canEdit: true,
    });
    expect(item.departmentIds).toHaveLength(1);
    const [log] = await changesOf(item.id);
    expect(log).toMatchObject({ action: "create", actorUserId: "tech-staff" });
    expect(defined(log, "log").changes.title).toEqual([null, "VALORANT รอบรองชนะเลิศ"]);

    const confirmed = await create({
      status: "confirmed",
      confirm: true,
      startAt: START + 3 * HOUR,
      endAt: START + 5 * HOUR,
    });
    expect(confirmed.tbd).toBe(false);
  });

  test("rejects categories and statuses from another mode", async () => {
    const wrongCategory = await send(
      "tech-staff",
      "POST",
      "/items",
      match({ category: "release" }),
    );
    expect(wrongCategory.res.status).toBe(400);
    const wrongStatus = await send("tech-staff", "POST", "/items", match({ status: "released" }));
    expect(wrongStatus.res.status).toBe(400);
    await create({ mode: "delivery", category: "release", status: "planned" });
  });

  test("rejects an end before the start and unknown owners", async () => {
    const backwards = await send("tech-staff", "POST", "/items", match({ endAt: START }));
    expect(backwards.res.status).toBe(400);
    const noOwner = await send("tech-staff", "POST", "/items", match({ ownerId: "nobody" }));
    expect(noOwner.res.status).toBe(400);
    const guestOwner = await send("tech-staff", "POST", "/items", match({ ownerId: "guest" }));
    expect(guestOwner.res.status).toBe(400);
  });

  test("rejects links that are not https", async () => {
    const res = await send(
      "tech-staff",
      "POST",
      "/items",
      match({ scoreboardUrl: "javascript:alert(1)" }),
    );
    expect(res.res.status).toBe(400);
  });

  test("only approvers publish, and never a TBD item", async () => {
    const publicMatch = { visibility: "public", status: "confirmed", confirm: true };
    expect((await send("tech-staff", "POST", "/items", match(publicMatch))).res.status).toBe(403);
    const tbd = await send("tech-head", "POST", "/items", match({ visibility: "public" }));
    expect(tbd.res.status).toBe(400);
    const item = await create(publicMatch, "tech-head");
    expect(item.visibility).toBe("public");
  });
});

describe("list", () => {
  test("returns items that overlap the range, archived ones only on request", async () => {
    const inside = await create();
    // Starts before the window and ends inside it.
    const spanning = await create({ startAt: START - 30 * HOUR, endAt: START - 20 * HOUR });
    await create({ startAt: START + 48 * HOUR, endAt: START + 50 * HOUR });
    const { body } = await send<{ items: Item[] }>("art-staff", "GET", range());
    expect(body.items.map((item) => item.id).sort()).toEqual([inside.id, spanning.id].sort());
    expect(body.items.every((item) => item.canEdit === false)).toBe(true);

    await send("tech-staff", "PATCH", `/items/${inside.id}`, { archived: true, version: 1 });
    const visible = await send<{ items: Item[] }>("tech-staff", "GET", range());
    expect(visible.body.items.map((item) => item.id)).toEqual([spanning.id]);
    const all = await send<{ items: Item[] }>(
      "tech-staff",
      "GET",
      `${range()}&includeArchived=true`,
    );
    expect(all.body.items).toHaveLength(2);
  });

  test("filters by mode, status, department and search", async () => {
    const sports = await t.departmentId("กีฬา");
    const matchItem = await create({ departmentIds: [sports] });
    const release = await create({
      title: "Scoreboard v2",
      mode: "delivery",
      category: "release",
      status: "planned",
      // After the match, so the release window does not overlap it.
      startAt: START + 4 * HOUR,
      endAt: START + 5 * HOUR,
      feature: "Live scoreboard",
      game: null,
      matchId: null,
      teams: null,
    });
    const ids = async (query: string) =>
      (await send<{ items: Item[] }>("tech-staff", "GET", `${range()}&${query}`)).body.items.map(
        (item) => item.id,
      );
    expect(await ids("mode=delivery")).toEqual([release.id]);
    expect(await ids("mode=operations,delivery")).toHaveLength(2);
    expect(await ids("status=draft")).toEqual([matchItem.id]);
    expect(await ids(`departmentId=${sports}`)).toEqual([matchItem.id]);
    expect(await ids("q=VAL-SF1")).toEqual([matchItem.id]);
    expect(await ids("q=Team%20B")).toEqual([matchItem.id]);
    expect(await ids("q=scoreboard")).toEqual([release.id]);
    expect(await ids("q=Tech%20Staff")).toHaveLength(2);
    expect(await ids("q=100%25")).toEqual([]);
  });

  test("refuses ranges over 62 days", async () => {
    const res = await send("tech-staff", "GET", range(START, START + 63 * 24 * HOUR));
    expect(res.res.status).toBe(400);
  });
});

describe("update", () => {
  test("rescheduling needs a reason, drops the confirmation and is logged", async () => {
    const item = await create({ status: "confirmed", confirm: true });
    const moved = { startAt: START + HOUR, endAt: START + 3 * HOUR, version: 1 };
    expect((await send("tech-staff", "PATCH", `/items/${item.id}`, moved)).res.status).toBe(400);
    const { res, body } = await send<Item>("tech-staff", "PATCH", `/items/${item.id}`, {
      ...moved,
      reason: "Sports moved the slot",
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ startAt: START + HOUR, version: 2, tbd: true });
    expect(body.lastConfirmedAt).toBeNull();
    const log = defined((await changesOf(item.id)).at(-1), "log");
    expect(log).toMatchObject({ action: "reschedule", reason: "Sports moved the slot" });
    expect(log.changes.startAt).toEqual([START, START + HOUR]);
  });

  test("cancelling needs a reason", async () => {
    const item = await create();
    const cancel = { status: "cancelled", version: 1 };
    expect((await send("tech-staff", "PATCH", `/items/${item.id}`, cancel)).res.status).toBe(400);
    const { res } = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      ...cancel,
      reason: "Team withdrew",
    });
    expect(res.status).toBe(200);
    expect(defined((await changesOf(item.id)).at(-1), "log").action).toBe("cancel");
  });

  test("confirming stamps who and when", async () => {
    const item = await create();
    const { body } = await send<Item>("tech-staff", "PATCH", `/items/${item.id}`, {
      status: "confirmed",
      confirm: true,
      version: 1,
    });
    expect(body.tbd).toBe(false);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.lastConfirmedById).toBe("tech-staff");
  });

  test("refuses an edit based on an old version", async () => {
    const item = await create();
    await send("tech-staff", "PATCH", `/items/${item.id}`, { title: "First", version: 1 });
    const { res } = await send("tech-head", "PATCH", `/items/${item.id}`, {
      title: "Second",
      version: 1,
    });
    expect(res.status).toBe(409);
  });

  test("only approvers change visibility, and TBD items stay internal", async () => {
    const item = await create();
    const publish = { visibility: "public", version: 1 };
    expect((await send("tech-staff", "PATCH", `/items/${item.id}`, publish)).res.status).toBe(403);
    expect((await send("tech-head", "PATCH", `/items/${item.id}`, publish)).res.status).toBe(400);
    const { res, body } = await send<Item>("tech-head", "PATCH", `/items/${item.id}`, {
      ...publish,
      status: "confirmed",
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(body.visibility).toBe("public");
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.approvedById).toBe("tech-head");
  });

  test("replaces the departments and logs the change", async () => {
    const item = await create({ departmentIds: [await t.departmentId("กีฬา")] });
    const venue = await t.departmentId("สถานที่");
    const { body } = await send<Item>("tech-staff", "PATCH", `/items/${item.id}`, {
      departmentIds: [venue],
      version: 1,
    });
    expect(body.departmentIds).toEqual([venue]);
    expect(defined((await changesOf(item.id)).at(-1), "log").action).toBe("update");
  });

  test("a no-op edit writes nothing", async () => {
    const item = await create();
    const { body } = await send<Item>("tech-staff", "PATCH", `/items/${item.id}`, {
      title: item.title,
      version: 1,
    });
    expect(body.version).toBe(1);
    expect(await changesOf(item.id)).toHaveLength(1);
  });
});

describe("races", () => {
  test("an editor moved out of Tech/Live mid-request writes nothing", async () => {
    const item = await create();
    const art = await t.departmentId("Art");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE user SET department_id = ? WHERE id = 'tech-staff'", [art]);
    };
    const { res } = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      title: "Changed",
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row).toMatchObject({ title: item.title, version: 1 });
    expect(await changesOf(item.id)).toHaveLength(1);
  });

  test("an approver who lost the seat mid-request cannot publish", async () => {
    const item = await create({ status: "confirmed", confirm: true });
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("DELETE FROM leadership WHERE user_id = 'tech-head'");
    };
    const { res } = await send("tech-head", "PATCH", `/items/${item.id}`, {
      visibility: "public",
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.visibility).toBe("internal");
    expect(await t.db.select().from(leadership).where(eq(leadership.userId, "tech-head"))).toEqual(
      [],
    );
  });

  test("an edit saved by someone else mid-request wins", async () => {
    const item = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE calendar_item SET version = 2, title = 'Other' WHERE id = ?", [item.id]);
    };
    const { res } = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      title: "Mine",
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.title).toBe("Other");
  });
});

describe("duplicate and detail", () => {
  test("copies an item as an internal draft and logs both sides", async () => {
    const source = await create(
      { status: "confirmed", confirm: true, visibility: "public" },
      "tech-head",
    );
    const { res, body } = await send<Item>(
      "tech-staff",
      "POST",
      `/items/${source.id}/duplicate`,
      {},
    );
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      title: source.title,
      status: "draft",
      visibility: "internal",
      tbd: true,
    });
    expect(body.id).not.toBe(source.id);
    expect(defined((await changesOf(source.id)).at(-1), "log").action).toBe("duplicate");
    expect((await changesOf(body.id)).map((change) => change.action)).toEqual(["duplicate"]);
  });

  test("the detail includes departments and the change log with names", async () => {
    const item = await create({ departmentIds: [await t.departmentId("กีฬา")] });
    await send("tech-staff", "PATCH", `/items/${item.id}`, { title: "Renamed", version: 1 });
    const { res, body } = await send<{
      departments: { name: string }[];
      changes: { action: string; actorName: string }[];
    }>("art-staff", "GET", `/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(body.departments.map((dept) => dept.name)).toEqual(["กีฬา"]);
    expect(body.changes.map((change) => change.action)).toEqual(["update", "create"]);
    expect(body.changes[0]?.actorName).toBe("Tech Staff");
  });

  test("unknown items are 404", async () => {
    const missing = crypto.randomUUID();
    expect((await send("tech-staff", "GET", `/items/${missing}`)).res.status).toBe(404);
    expect(
      (await send("tech-staff", "PATCH", `/items/${missing}`, { title: "x", version: 1 })).res
        .status,
    ).toBe(404);
  });
});
