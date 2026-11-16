import { beforeEach, describe, expect, test } from "bun:test";
import { event, venue } from "@it3k/db/schema/index";

import { createTestContext, readJson } from "../../testing";
import { PREVIEW_DESCRIPTION_LIMIT, createPublicEventRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createPublicEventRoutes>;

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  t = createTestContext();
  app = createPublicEventRoutes(t.deps);
  const now = Date.now();
  await t.db.insert(venue).values({ id: "v-hall", name: "หอประชุม" });
  await t.db.insert(event).values([
    {
      id: "e-open",
      type: "general",
      name: "พิธีเปิด",
      slug: "opening",
      description: "ขบวนพาเหรด\n\nและการแสดง",
      startAt: new Date(now + 2 * HOUR),
      endAt: new Date(now + 3 * HOUR),
      venueId: "v-hall",
      thumbnailUrl: "https://files.example/cover.png",
      ticketsOpen: true,
    },
    {
      id: "e-soon",
      type: "sport",
      name: "ฟุตบอล",
      startAt: new Date(now + HOUR),
      endAt: new Date(now + 3 * HOUR),
      ticketsOpen: true,
    },
    {
      id: "e-closed",
      type: "general",
      name: "ปิดรับ",
      startAt: new Date(now + HOUR),
      endAt: new Date(now + 3 * HOUR),
    },
    {
      id: "e-over",
      type: "general",
      name: "จบแล้ว",
      startAt: new Date(now - 3 * HOUR),
      endAt: new Date(now - HOUR),
      ticketsOpen: true,
    },
  ]);
});

async function get<T = Record<string, unknown>>(path: string) {
  // No session at all: previews are fetched signed out.
  const res = await app.request(path);
  return { res, body: (await readJson(res)) as T };
}

describe("public event previews", () => {
  test("one event by slug or id, signed out, with only preview fields", async () => {
    for (const ref of ["opening", "e-open"]) {
      const { res, body } = await get(`/${ref}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("public");
      expect(body).toEqual({
        id: "e-open",
        slug: "opening",
        name: "พิธีเปิด",
        description: "ขบวนพาเหรด และการแสดง",
        startAt: expect.any(String),
        endAt: expect.any(String),
        thumbnailUrl: "https://files.example/cover.png",
        venue: "หอประชุม",
      });
    }
    expect((await get("/nope")).res.status).toBe(404);
  });

  test("a long description is clipped", async () => {
    await t.db.insert(event).values({
      id: "e-long",
      type: "general",
      name: "ยาว",
      description: "ก".repeat(PREVIEW_DESCRIPTION_LIMIT * 2),
      startAt: new Date(),
      endAt: new Date(Date.now() + HOUR),
    });
    const { body } = await get<{ description: string }>("/e-long");
    expect(body.description).toHaveLength(PREVIEW_DESCRIPTION_LIMIT);
    expect(body.description.endsWith("…")).toBe(true);
  });

  test("the events page counts events taking tickets now, soonest first", async () => {
    const { res, body } = await get("/");
    expect(res.status).toBe(200);
    expect(body).toEqual({
      total: 2,
      items: [
        { name: "ฟุตบอล", thumbnailUrl: null },
        { name: "พิธีเปิด", thumbnailUrl: "https://files.example/cover.png" },
      ],
    });
  });
});
