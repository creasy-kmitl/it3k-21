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
  await t.seedUser("art-head", { department: "Art", seat: "head", name: "Art Head" });
});

let slot = 0;
async function create(overrides: Record<string, unknown> = {}) {
  slot += 3;
  const res = await staff.request(
    "/items",
    t.as("art-head", {
      method: "POST",
      json: {
        title: "Art Exhibition",
        status: "confirmed",
        visibility: "public",
        startAt: START + slot * HOUR,
        endAt: START + (slot + 2) * HOUR,
        ownerId: "art-head",
        venue: "Hall 1, Floor 2",
        notes: "private: call Somchai 081-000-0000",
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
  test("shows approved, confirmed items without anything private", async () => {
    await create();
    const { res, body } = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
      ["department", "endAt", "id", "startAt", "title", "updatedAt", "venue"].sort(),
    );
    expect(body.items[0]).toMatchObject({ department: { name: "Art", color: "rose" } });
    // The private note's phone number and owner never leave the team.
    expect(JSON.stringify(body)).not.toContain("081-000-0000");
    expect(JSON.stringify(body)).not.toContain("Somchai");
    expect(JSON.stringify(body)).not.toContain("art-head");
  });

  test("never shows internal or cancelled items", async () => {
    await create({ visibility: "internal", title: "Internal" });
    const cancelled = await create({ title: "Cancelled" });
    await staff.request(
      `/items/${cancelled.body.id}`,
      t.as("art-head", {
        method: "PATCH",
        json: { status: "cancelled", reason: "ยกเลิก", version: 1 },
      }),
    );
    expect((await list()).body.items).toEqual([]);
  });

  test("a rescheduled public item stays public at its new time", async () => {
    const item = await create();
    await staff.request(
      `/items/${item.body.id}`,
      t.as("art-head", {
        method: "PATCH",
        json: {
          startAt: START + 40 * HOUR,
          endAt: START + 42 * HOUR,
          reason: "เลื่อน",
          version: 1,
        },
      }),
    );
    expect((await list()).body.items[0]).toMatchObject({ startAt: START + 40 * HOUR });
  });

  test("a head's draft is never published, and a draft made from a public item leaves", async () => {
    expect((await create({ status: "draft" })).res.status).toBe(400);
    const item = await create();
    await staff.request(
      `/items/${item.body.id}`,
      t.as("art-head", { method: "PATCH", json: { status: "draft", version: 1 } }),
    );
    expect((await list()).body.items).toEqual([]);
  });

  test("shows every department's published items, without collaborators", async () => {
    await t.seedUser("reg-head", { department: "ทะเบียน", seat: "head", name: "Reg Head" });
    const registration = await t.departmentId("ทะเบียน");
    await create({ collaboratorIds: [registration] });
    await staff.request(
      "/items",
      t.as("reg-head", {
        method: "POST",
        json: {
          title: "Registration opens",
          visibility: "public",
          startAt: START + 50 * HOUR,
          endAt: START + 51 * HOUR,
        },
      }),
    );
    const { body } = await list();
    expect(body.items.map((item) => (item.department as { name: string }).name)).toEqual([
      "Art",
      "ทะเบียน",
    ]);
    expect(JSON.stringify(body)).not.toContain("collaborators");
  });

  test("takes an explicit window and refuses a backwards one", async () => {
    await create();
    const later = await open.request(`/?from=${START + 30 * DAY}&to=${START + 31 * DAY}`);
    expect(((await readJson(later)) as { items: unknown[] }).items).toEqual([]);
    expect((await open.request(`/?from=${START}&to=${START - DAY}`)).status).toBe(400);
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
    expect(text).toContain("SUMMARY:Art Exhibition\r\n");
    expect(text).toContain("CATEGORIES:Art\r\n");
    expect(text).toContain("LOCATION:Hall 1\\, Floor 2\r\n");
    expect(text).not.toContain("081-000-0000");
    expect(text).not.toContain("Somchai");
  });
});

describe("toIcs", () => {
  test("escapes commas, semicolons, backslashes and newlines", () => {
    const ics = toIcs(
      [
        {
          id: "x",
          title: "A, B; C\\D",
          startAt: Date.UTC(2026, 9, 10, 6),
          endAt: Date.UTC(2026, 9, 10, 8),
          venue: "Hall\nFloor 2",
          department: { id: "d", name: "PR", icon: "megaphone", color: "fuchsia" },
          updatedAt: Date.UTC(2026, 9, 1),
        },
      ],
      Date.UTC(2026, 9, 1),
    );
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\\\D\r\n");
    expect(ics).toContain("LOCATION:Hall\\nFloor 2\r\n");
    expect(ics).toContain("CATEGORIES:PR\r\n");
    expect(ics).toEndWith("END:VCALENDAR\r\n");
  });

  test("folds long Thai lines without splitting characters", () => {
    const ics = toIcs(
      [
        {
          id: "x",
          title: "การแข่งขันรอบชิงชนะเลิศประเภททีมระดับมหาวิทยาลัยประจำปี",
          startAt: Date.UTC(2026, 9, 10, 6),
          endAt: Date.UTC(2026, 9, 10, 8),
          venue: null,
          department: { id: "d", name: "กีฬา", icon: "trophy", color: "green" },
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
