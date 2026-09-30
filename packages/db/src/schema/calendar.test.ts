import { Database as Sqlite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { applyMigrations, createTestDb, defined } from "../testing";
import {
  calendarChange,
  calendarItem,
  calendarItemCollaborator,
  calendarNotification,
  department,
  user,
} from "./index";

const MINIMAL_CALENDAR = "20260930083849_minimal_calendar";
const START = Date.UTC(2026, 9, 10, 6);
const HOUR = 60 * 60 * 1000;

describe("migrating the Tech/Live calendar to the minimal one", () => {
  let sqlite: Sqlite;

  /** An item in the Tech/Live schema, before the minimal calendar. */
  function oldItem(id: string, status: string, extra: Record<string, unknown> = {}) {
    const row = {
      id,
      title: `Item ${id}`,
      mode: "operations",
      category: "match",
      status,
      start_at: START,
      end_at: START + HOUR,
      owner_id: "u1",
      visibility: "internal",
      approved_at: null,
      approved_by_id: null,
      archived_at: null,
      venue: "Hall 1",
      notes: "note",
      game: "valorant",
      ...extra,
    };
    const columns = Object.keys(row);
    sqlite.run(
      `INSERT INTO calendar_item (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      Object.values(row) as (string | number | null)[],
    );
  }

  const rows = () =>
    sqlite
      .query(
        "SELECT id, status, visibility, approved_at, department_id, venue, notes FROM calendar_item ORDER BY id",
      )
      .all() as {
      id: string;
      status: string;
      visibility: string;
      approved_at: number | null;
      department_id: string;
      venue: string | null;
      notes: string | null;
    }[];

  const tables = () =>
    (
      sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((table) => table.name);

  beforeEach(() => {
    sqlite = new Sqlite(":memory:", { strict: true });
    sqlite.run("PRAGMA foreign_keys = ON");
    applyMigrations(sqlite, { before: MINIMAL_CALENDAR });
    sqlite.run("INSERT INTO user (id, name, email) VALUES ('u1', 'U1', 'u1@example.com')");
  });

  test("moves every item to Tech/Live and folds old statuses into three", () => {
    oldItem("a-draft", "draft");
    oldItem("b-backlog", "backlog", { mode: "delivery", category: "development" });
    oldItem("c-live", "live");
    oldItem("d-released", "released", { mode: "delivery", category: "release" });
    oldItem("e-cancelled", "cancelled");
    oldItem("f-rolled-back", "rolled_back", { mode: "delivery", category: "release" });
    oldItem("g-completed", "completed");
    applyMigrations(sqlite, { from: MINIMAL_CALENDAR });

    const techLive = sqlite.query("SELECT id FROM department WHERE code = 'tech-live'").get() as {
      id: string;
    };
    expect(rows().map((row) => [row.id, row.status])).toEqual([
      ["a-draft", "draft"],
      ["b-backlog", "draft"],
      ["c-live", "confirmed"],
      ["d-released", "confirmed"],
      ["e-cancelled", "cancelled"],
      ["f-rolled-back", "cancelled"],
      ["g-completed", "confirmed"],
    ]);
    expect(new Set(rows().map((row) => row.department_id))).toEqual(new Set([techLive.id]));
    // The fields the minimal calendar keeps come across.
    expect(rows()[0]).toMatchObject({ venue: "Hall 1", notes: "note" });
  });

  test("keeps only confirmed items public and drops archived ones", () => {
    oldItem("a-public", "live", { visibility: "public", approved_at: START, approved_by_id: "u1" });
    oldItem("b-draft-public", "draft", { visibility: "public", approved_at: START });
    oldItem("c-archived", "confirmed", { archived_at: START });
    applyMigrations(sqlite, { from: MINIMAL_CALENDAR });

    expect(rows().map((row) => [row.id, row.visibility, row.approved_at])).toEqual([
      ["a-public", "public", START],
      ["b-draft-public", "internal", null],
    ]);
  });

  test("drops the Tech/Live-only tables and the notices about them", () => {
    oldItem("a", "confirmed");
    const techLive = sqlite.query("SELECT id FROM department WHERE code = 'tech-live'").get() as {
      id: string;
    };
    sqlite.run(
      "INSERT INTO calendar_item_department (id, item_id, department_id) VALUES ('link', 'a', ?)",
      [techLive.id],
    );
    sqlite.run(
      "INSERT INTO calendar_checklist_item (id, item_id, key) VALUES ('check', 'a', 'network')",
    );
    sqlite.run(
      "INSERT INTO calendar_notification (id, user_id, item_id, kind, item_title, data) VALUES ('n', 'u1', 'a', 'request', 'a', '{}')",
    );
    applyMigrations(sqlite, { from: MINIMAL_CALENDAR });

    for (const gone of [
      "calendar_item_department",
      "calendar_action_item",
      "calendar_checklist_item",
      "calendar_dependency",
      "calendar_decision",
    ]) {
      expect(tables()).not.toContain(gone);
    }
    expect(tables()).toContain("calendar_item_collaborator");
    expect(sqlite.query("SELECT count(*) AS n FROM calendar_notification").get()).toEqual({ n: 0 });
    expect(rows().map((row) => row.id)).toEqual(["a"]);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("calendar schema", () => {
  let t: ReturnType<typeof createTestDb>;
  let art: string;
  let registration: string;

  beforeEach(async () => {
    t = createTestDb();
    const departments = await t.db.select().from(department);
    art = defined(departments.find((d) => d.name === "Art")).id;
    registration = defined(departments.find((d) => d.name === "ทะเบียน")).id;
    await t.db.insert(user).values({ id: "u1", name: "U1", email: "u1@example.com" });
  });

  async function insertItem(values: Partial<typeof calendarItem.$inferInsert> = {}) {
    const [row] = await t.db
      .insert(calendarItem)
      .values({
        departmentId: art,
        title: "Item",
        status: "confirmed",
        startAt: new Date(START),
        endAt: new Date(START + HOUR),
        ...values,
      })
      .returning();
    return defined(row);
  }

  test("refuses unknown statuses and items that end before they start", async () => {
    await expect(insertItem({ status: "live" as never })).rejects.toThrow();
    await expect(insertItem({ endAt: new Date(START) })).rejects.toThrow();
    await expect(insertItem({ visibility: "secret" as never })).rejects.toThrow();
  });

  test("names each collaborating department once per item", async () => {
    const item = await insertItem();
    await t.db
      .insert(calendarItemCollaborator)
      .values({ itemId: item.id, departmentId: registration });
    const again = async () =>
      t.db.insert(calendarItemCollaborator).values({ itemId: item.id, departmentId: registration });
    await expect(again()).rejects.toThrow();
  });

  test("deleting an item removes its collaborators and notices but keeps its history", async () => {
    const item = await insertItem();
    await t.db
      .insert(calendarItemCollaborator)
      .values({ itemId: item.id, departmentId: registration });
    await t.db.insert(calendarNotification).values({
      userId: "u1",
      itemId: item.id,
      kind: "assignment",
      itemTitle: item.title,
      data: {},
    });
    await t.db.insert(calendarChange).values({
      itemId: item.id,
      actorUserId: "u1",
      action: "create",
      changes: {},
    });
    await t.db.delete(calendarItem).where(eq(calendarItem.id, item.id));
    expect(await t.db.select().from(calendarItemCollaborator)).toEqual([]);
    expect(await t.db.select().from(calendarNotification)).toEqual([]);
    expect(await t.db.select().from(calendarChange)).toHaveLength(1);
  });

  test("deleting a department removes its items and its collaborations", async () => {
    const owned = await insertItem({ departmentId: registration });
    const shared = await insertItem();
    await t.db
      .insert(calendarItemCollaborator)
      .values({ itemId: shared.id, departmentId: registration });
    await t.db.delete(department).where(eq(department.id, registration));
    const left = await t.db.select().from(calendarItem);
    expect(left.map((item) => item.id)).toEqual([shared.id]);
    expect(left.some((item) => item.id === owned.id)).toBe(false);
    expect(await t.db.select().from(calendarItemCollaborator)).toEqual([]);
  });

  test("a deleted account leaves the item without an owner", async () => {
    const item = await insertItem({ ownerId: "u1", createdById: "u1" });
    await t.db.delete(user).where(eq(user.id, "u1"));
    const [row] = await t.db.select().from(calendarItem).where(eq(calendarItem.id, item.id));
    expect(row).toMatchObject({ ownerId: null, createdById: null });
  });
});
