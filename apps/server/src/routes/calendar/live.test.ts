import { beforeEach, describe, expect, test } from "bun:test";
import { LIVE_CHECKLIST } from "@it3k/db/calendar-rules";
import { calendarChecklistItem, calendarItem } from "@it3k/db/schema/index";
import { and, eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createCalendarRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCalendarRoutes>;

const HOUR = 60 * 60 * 1000;
// 2026-10-10 13:00 Bangkok time.
const START = Date.UTC(2026, 9, 10, 6);

type Conflict = { id: string; title: string; kinds: string[]; people: string[] };
type Item = {
  id: string;
  version: number;
  status: string;
  checklistDone: number | null;
  onCallOwner: { id: string; name: string } | null;
  mitigation: string | null;
  checklist?: { key: string; checked: boolean; checkedBy: string | null }[] | null;
  canCheck?: boolean;
};

beforeEach(async () => {
  t = createTestContext();
  app = createCalendarRoutes(t.deps);
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("tech-other", { department: "Tech/Live", name: "Tech Other" });
  await t.seedUser("oncall", { department: "Production", name: "On Call" });
  await t.seedUser("art-staff", { department: "Art", name: "Art Staff" });
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
  title: "VALORANT SF",
  mode: "operations",
  category: "match",
  status: "confirmed",
  startAt: START,
  endAt: START + 2 * HOUR,
  ownerId: "tech-staff",
  source: "Sports schedule",
  ...overrides,
});

async function create(overrides: Record<string, unknown> = {}) {
  const { res, body } = await send<Item>("tech-staff", "POST", "/items", match(overrides));
  expect(res.status).toBe(201);
  return body;
}

const tick = (who: string, itemId: string, key: string, checked = true) =>
  send(who, "PUT", `/items/${itemId}/checklist/${key}`, { checked });

async function tickAll(itemId: string) {
  for (const key of LIVE_CHECKLIST)
    expect((await tick("tech-staff", itemId, key)).res.status).toBe(200);
}

describe("live checklist", () => {
  test("a match starts with an empty seven-point checklist", async () => {
    const item = await create();
    expect(item.checklistDone).toBe(0);
    const { body } = await send<Item>("art-staff", "GET", `/items/${item.id}`);
    expect(body.checklist?.map((entry) => entry.key)).toEqual([...LIVE_CHECKLIST]);
    expect(body.canCheck).toBe(false);
  });

  test("items that are not live blocks have none", async () => {
    const item = await create({ mode: "meetings", category: "planning" });
    expect(item.checklistDone).toBeNull();
    expect((await tick("tech-staff", item.id, "network")).res.status).toBe(400);
  });

  test("editors and the on-call owner tick it; others cannot", async () => {
    const item = await create({ onCallOwnerId: "oncall" });
    expect((await tick("art-staff", item.id, "network")).res.status).toBe(403);
    expect((await tick("oncall", item.id, "network")).res.status).toBe(200);
    expect((await tick("tech-other", item.id, "audio")).res.status).toBe(200);
    const { body } = await send<Item>("oncall", "GET", `/items/${item.id}`);
    expect(body.canCheck).toBe(true);
    expect(body.checklistDone).toBe(2);
    expect(body.checklist?.find((entry) => entry.key === "network")).toMatchObject({
      checked: true,
      checkedBy: "On Call",
    });
    await tick("oncall", item.id, "network", false);
    expect((await send<Item>("oncall", "GET", `/items/${item.id}`)).body.checklistDone).toBe(1);
  });

  test("an on-call owner replaced mid-request cannot tick", async () => {
    const item = await create({ onCallOwnerId: "oncall" });
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE calendar_item SET on_call_owner_id = 'tech-other' WHERE id = ?", [
        item.id,
      ]);
    };
    expect((await tick("oncall", item.id, "network")).res.status).toBe(409);
  });
});

describe("ready and live", () => {
  test("need the whole checklist and someone on call", async () => {
    const item = await create();
    const ready = { status: "ready", version: 1 };
    const refused = await send<{ missing: string[] }>(
      "tech-staff",
      "PATCH",
      `/items/${item.id}`,
      ready,
    );
    expect(refused.res.status).toBe(400);
    expect(refused.body.missing).toEqual(["onCall", ...LIVE_CHECKLIST]);

    await tickAll(item.id);
    const { res, body } = await send<Item>("tech-staff", "PATCH", `/items/${item.id}`, {
      ...ready,
      onCallOwnerId: "oncall",
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ready", onCallOwner: { name: "On Call" } });
  });

  test("a new item cannot start out ready", async () => {
    const res = await send("tech-staff", "POST", "/items", match({ status: "ready" }));
    expect(res.res.status).toBe(400);
  });

  test("rescheduling unticks the confirmed times", async () => {
    const item = await create({ onCallOwnerId: "oncall" });
    await tickAll(item.id);
    await send("tech-staff", "PATCH", `/items/${item.id}`, {
      startAt: START + HOUR,
      endAt: START + 3 * HOUR,
      reason: "เลื่อนรอบ",
      version: 1,
    });
    const [times] = await t.db
      .select()
      .from(calendarChecklistItem)
      .where(
        and(eq(calendarChecklistItem.itemId, item.id), eq(calendarChecklistItem.key, "times")),
      );
    expect(times?.checked).toBe(false);
    const res = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      status: "live",
      version: 2,
    });
    expect(res.res.status).toBe(400);
  });

  test("an entry unticked mid-request stops the item going live", async () => {
    const item = await create({ onCallOwnerId: "oncall" });
    await tickAll(item.id);
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE calendar_checklist_item SET checked = 0 WHERE key = 'audio'");
    };
    const res = await send("tech-staff", "PATCH", `/items/${item.id}`, {
      status: "live",
      version: 1,
    });
    expect(res.res.status).toBe(409);
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row?.status).toBe("confirmed");
  });
});

describe("conflicts", () => {
  test("warns about a person booked twice and saves once a mitigation is given", async () => {
    const first = await create({ title: "VALORANT SF1", onCallOwnerId: "oncall" });
    const second = match({
      title: "RoV SF1",
      ownerId: "tech-other",
      scoreboardOperatorId: "oncall",
      startAt: START + HOUR,
      endAt: START + 3 * HOUR,
    });
    const warned = await send<{ conflicts: Conflict[] }>("tech-staff", "POST", "/items", second);
    expect(warned.res.status).toBe(422);
    expect(warned.body.conflicts).toEqual([
      expect.objectContaining({ id: first.id, kinds: ["person"], people: ["On Call"] }),
    ]);
    const noPlan = await send("tech-staff", "POST", "/items", { ...second, acceptConflicts: true });
    expect(noPlan.res.status).toBe(400);
    const saved = await send<Item>("tech-staff", "POST", "/items", {
      ...second,
      acceptConflicts: true,
      mitigation: "ให้ Tech Other คุม scoreboard แทนช่วงทับกัน",
    });
    expect(saved.res.status).toBe(201);
    expect(saved.body.mitigation).toBe("ให้ Tech Other คุม scoreboard แทนช่วงทับกัน");
  });

  test("the same venue or stream clashes, ignoring case and spaces", async () => {
    await create({ venue: "Studio A", streamPlatform: "YouTube Main" });
    const { res, body } = await send<{ conflicts: Conflict[] }>(
      "tech-staff",
      "POST",
      "/items",
      match({ ownerId: "tech-other", venue: " studio a ", streamPlatform: "youtube main" }),
    );
    expect(res.status).toBe(422);
    expect(defined(body.conflicts[0], "conflict").kinds).toEqual(["venue", "stream"]);
  });

  test("cancelled, adjacent and delivery items never clash", async () => {
    const cancelled = await create();
    await send("tech-staff", "PATCH", `/items/${cancelled.id}`, {
      status: "cancelled",
      reason: "ยกเลิก",
      version: 1,
    });
    // Starts exactly when the cancelled one would have ended.
    await create({ startAt: START + 2 * HOUR, endAt: START + 3 * HOUR });
    await create({
      mode: "delivery",
      category: "development",
      status: "in_progress",
      startAt: START + 2 * HOUR,
      endAt: START + 30 * HOUR,
    });
  });

  test("moving an item into a clash warns; unrelated edits do not", async () => {
    await create({ title: "A" });
    const later = await create({ title: "B", startAt: START + 3 * HOUR, endAt: START + 4 * HOUR });
    const rename = await send("tech-staff", "PATCH", `/items/${later.id}`, {
      title: "B2",
      version: 1,
    });
    expect(rename.res.status).toBe(200);
    const move = await send("tech-staff", "PATCH", `/items/${later.id}`, {
      startAt: START + HOUR,
      endAt: START + 2 * HOUR,
      reason: "ย้าย",
      version: 2,
    });
    expect(move.res.status).toBe(422);
    const accepted = await send<Item>("tech-staff", "PATCH", `/items/${later.id}`, {
      startAt: START + HOUR,
      endAt: START + 2 * HOUR,
      reason: "ย้าย",
      acceptConflicts: true,
      mitigation: "Tech Staff ดูทั้งสองงานจากห้องเดียวกัน",
      version: 2,
    });
    expect(accepted.res.status).toBe(200);
  });
});
