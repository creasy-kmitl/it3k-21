import { beforeEach, describe, expect, test } from "bun:test";

import { createTestContext, readJson } from "../../testing";
import { createCalendarRoutes } from "../calendar";
import { createPublicCalendarRoutes, toIcs } from ".";

let t: ReturnType<typeof createTestContext>;
let staff: ReturnType<typeof createCalendarRoutes>;
let open: ReturnType<typeof createPublicCalendarRoutes>;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Tomorrow, so the default window (a day back, 30 days ahead) covers it.
const START = Math.floor(Date.now() / HOUR) * HOUR + DAY;

beforeEach(async () => {
  t = createTestContext();
  staff = createCalendarRoutes(t.deps);
  open = createPublicCalendarRoutes(t.deps);
  await t.seedUser("tech-head", { department: "Tech/Live", seat: "head", name: "Tech Head" });
});

let slot = 0;
async function create(overrides: Record<string, unknown> = {}) {
  // Each item gets its own slot, so none of them clash over the owner.
  slot += 3;
  const res = await staff.request(
    "/items",
    t.as("tech-head", {
      method: "POST",
      json: {
        title: "VALORANT Final",
        mode: "operations",
        category: "match",
        status: "confirmed",
        confirm: true,
        visibility: "public",
        startAt: START + slot * HOUR,
        endAt: START + (slot + 2) * HOUR,
        ownerId: "tech-head",
        source: "Sports",
        teams: ["Team A", "Team B"],
        venue: "Hall 1, Floor 2",
        notes: "private: call Somchai 081-000-0000",
        streamPlatform: "YouTube",
        ...overrides,
      },
    }),
  );
  return { res, body: (await readJson(res)) as { id: string; version: number } };
}

async function list() {
  const res = await open.request("/");
  return { res, body: (await readJson(res)) as { items: Record<string, unknown>[] } };
}

describe("public calendar", () => {
  test("shows approved, confirmed matches without anything private", async () => {
    await create();
    const { res, body } = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
      [
        "category",
        "endAt",
        "game",
        "id",
        "matchId",
        "scoreboardUrl",
        "startAt",
        "status",
        "streamPlatform",
        "teams",
        "title",
        "updatedAt",
        "venue",
      ].sort(),
    );
    // The private note's phone number and name never leave the team.
    expect(JSON.stringify(body)).not.toContain("081-000-0000");
    expect(JSON.stringify(body)).not.toContain("Somchai");
    expect(body.items[0]).toMatchObject({ status: "scheduled", teams: ["Team A", "Team B"] });
  });

  test("never shows internal, archived or items that became TBD", async () => {
    await create({ visibility: "internal", title: "Internal" });
    const archived = await create({ title: "Archived" });
    await staff.request(
      `/items/${archived.body.id}`,
      t.as("tech-head", { method: "PATCH", json: { archived: true, version: 1 } }),
    );
    const moved = await create({ title: "Moved" });
    // Rescheduling clears the confirmation, so it drops out until confirmed again.
    await staff.request(
      `/items/${moved.body.id}`,
      t.as("tech-head", {
        method: "PATCH",
        json: {
          startAt: START + 40 * HOUR,
          endAt: START + 42 * HOUR,
          reason: "เลื่อน",
          version: 1,
        },
      }),
    );
    expect((await list()).body.items).toEqual([]);
  });

  test("shows cancellations so viewers know", async () => {
    const item = await create();
    await staff.request(
      `/items/${item.body.id}`,
      t.as("tech-head", {
        method: "PATCH",
        json: { status: "cancelled", reason: "ทีมถอนตัว", version: 1 },
      }),
    );
    expect((await list()).body.items[0]).toMatchObject({ status: "cancelled" });
  });

  test("only live operations can be published", async () => {
    const { res } = await create({ mode: "meetings", category: "planning" });
    expect(res.status).toBe(400);
  });

  test("refuses ranges over 62 days", async () => {
    const res = await open.request(`/?from=${START}&to=${START + 63 * DAY}`);
    expect(res.status).toBe(400);
  });

  test("serves an iCalendar feed", async () => {
    await create();
    const res = await open.request("/calendar.ics");
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    const text = await res.text();
    expect(text).toStartWith("BEGIN:VCALENDAR\r\n");
    expect(text).toContain("SUMMARY:VALORANT Final\r\n");
    expect(text).toContain("LOCATION:Hall 1\\, Floor 2\r\n");
    expect(text).not.toContain("081-000-0000");
    expect(text).not.toContain("Somchai");
  });
});

describe("toIcs", () => {
  test("folds long Thai lines without splitting characters", () => {
    const ics = toIcs(
      [
        {
          id: "x",
          title: "การแข่งขันรอบชิงชนะเลิศประเภททีมระดับมหาวิทยาลัยประจำปี",
          category: "match",
          status: "scheduled",
          startAt: Date.UTC(2026, 9, 10, 6),
          endAt: Date.UTC(2026, 9, 10, 8),
          game: null,
          matchId: null,
          teams: [],
          venue: null,
          streamPlatform: null,
          scoreboardUrl: null,
          updatedAt: Date.UTC(2026, 9, 1),
        },
      ],
      Date.UTC(2026, 9, 1),
    );
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain("DTSTART:20261010T060000Z");
    // Unfolding gives the title back whole.
    expect(ics.replace(/\r\n /g, "")).toContain(
      "SUMMARY:การแข่งขันรอบชิงชนะเลิศประเภททีมระดับมหาวิทยาลัยประจำปี",
    );
  });
});
