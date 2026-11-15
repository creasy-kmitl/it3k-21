import { beforeEach, describe, expect, test } from "bun:test";
import { eventDivision, venue } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createEventRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createEventRoutes>;
let venueId: string;
let football: string;
let basketball: string;

const DAY = Date.UTC(2026, 11, 5, 2);
const HOUR = 60 * 60 * 1000;

type EventBody = {
  id: string;
  version: number;
  venue: { id: string; name: string } | null;
  institutions: string[];
  divisions: { id: string; name: string; sportName: string; icon: string }[];
};

function sportEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "sport",
    name: "ฟุตบอลรอบแรก",
    description: "",
    startAt: DAY,
    endAt: DAY + 3 * HOUR,
    venueId,
    thumbnailUrl: "",
    institutions: ["kmitl", "kmutt"],
    divisionIds: [football],
    ...overrides,
  };
}

const general = (overrides: Record<string, unknown> = {}) => ({
  type: "general",
  name: "พิธีเปิด",
  description: "เปิดงาน",
  startAt: DAY - 24 * HOUR,
  endAt: DAY - 22 * HOUR,
  venueId: null,
  thumbnailUrl: "",
  institutions: [],
  divisionIds: [],
  ...overrides,
});

beforeEach(async () => {
  t = createTestContext();
  app = createEventRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("reg-head", { department: "ทะเบียน", institution: "kmitl", seat: "head" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("reg-kmutt", { department: "ทะเบียน", institution: "kmutt", seat: "vicehead" });
  await t.seedUser("art", { department: "Art" });
  await t.seedUser("athlete", { role: "participant" });
  const [row] = await t.db.insert(venue).values({ name: "สนามฟุตบอลกลาง" }).returning();
  venueId = defined(row).id;
  football = await t.divisionId("football");
  basketball = await t.divisionId("basketball-3x3-female");
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

describe("creating", () => {
  test("only catalog managers create events", async () => {
    for (const who of ["reg-staff", "reg-kmutt", "art"]) {
      expect((await send(who, "POST", "/", sportEvent())).res.status).toBe(403);
    }
    expect((await send("athlete", "POST", "/", sportEvent())).res.status).toBe(403);
    for (const who of ["admin", "tech", "reg-head"]) {
      expect((await send(who, "POST", "/", sportEvent())).res.status).toBe(201);
    }
  });

  test("returns the event with its venue, institutions and divisions", async () => {
    const { res, body } = await send("tech", "POST", "/", sportEvent());
    expect(res.status).toBe(201);
    const created = body as unknown as EventBody;
    expect(created).toMatchObject({
      type: "sport",
      description: null,
      thumbnailUrl: null,
      version: 1,
      venue: { id: venueId, name: "สนามฟุตบอลกลาง" },
      institutions: ["kmitl", "kmutt"],
      divisions: [{ name: "ฟุตบอล", sportName: "กีฬาฟุตบอล", icon: "football" }],
    });
  });

  test("checks times and what each type may link to", async () => {
    const bad = [
      sportEvent({ endAt: DAY }),
      sportEvent({ endAt: DAY + 32 * 24 * HOUR }),
      sportEvent({ institutions: [] }),
      sportEvent({ divisionIds: [] }),
      sportEvent({ institutions: ["kmitl", "kmitl"] }),
      sportEvent({ institutions: ["harvard"] }),
      general({ institutions: ["kmitl"] }),
      general({ thumbnailUrl: "http://x.test/a.png" }),
    ];
    for (const json of bad) {
      expect((await send("tech", "POST", "/", json)).res.status).toBe(400);
    }
    expect((await send("tech", "POST", "/", general())).res.status).toBe(201);
  });

  test("an unknown venue or division is refused", async () => {
    const venueGone = await send("tech", "POST", "/", sportEvent({ venueId: "nope" }));
    expect(venueGone.res.status).toBe(400);
    expect(venueGone.body.message).toBe("ไม่พบสถานที่หรือประเภทกีฬาที่เลือก กรุณาโหลดใหม่");
    expect(
      (await send("tech", "POST", "/", sportEvent({ divisionIds: ["nope"] }))).res.status,
    ).toBe(400);
  });
});

describe("reading", () => {
  test("members list events in start order and filter them", async () => {
    await send("tech", "POST", "/", sportEvent());
    await send("tech", "POST", "/", general());
    const all = await send("art", "GET", "/");
    expect(all.res.status).toBe(200);
    expect((all.body.items as EventBody[]).map((item) => item.institutions)).toEqual([
      [],
      ["kmitl", "kmutt"],
    ]);
    expect(all.body.canManage).toBe(false);

    const sportOnly = await send("art", "GET", "/?type=sport");
    expect(sportOnly.body.items as unknown[]).toHaveLength(1);
    const upcoming = await send("art", "GET", `/?endsAfter=${DAY}`);
    expect(upcoming.body.items as unknown[]).toHaveLength(1);
    expect((await send("athlete", "GET", "/")).res.status).toBe(403);
  });

  test("reads one event", async () => {
    const { body } = await send("tech", "POST", "/", sportEvent());
    const one = await send("reg-staff", "GET", `/${body.id as string}`);
    expect(one.res.status).toBe(200);
    expect(one.body).toMatchObject({ id: body.id, canManage: false });
    expect((await send("reg-staff", "GET", "/nope")).res.status).toBe(404);
  });
});

describe("editing", () => {
  test("replaces the institutions and divisions, with a version guard", async () => {
    const { body } = await send("tech", "POST", "/", sportEvent());
    const id = body.id as string;
    const edited = await send("tech", "PUT", `/${id}`, {
      ...sportEvent({
        institutions: ["kmutnb-bangkok"],
        divisionIds: [basketball, football],
      }),
      version: 1,
    });
    expect(edited.res.status).toBe(200);
    expect(edited.body).toMatchObject({ version: 2, institutions: ["kmutnb-bangkok"] });
    expect((edited.body as unknown as EventBody).divisions).toHaveLength(2);

    const stale = await send("tech", "PUT", `/${id}`, { ...sportEvent(), version: 1 });
    expect(stale.res.status).toBe(409);

    const toGeneral = await send("tech", "PUT", `/${id}`, { ...general(), version: 2 });
    expect(toGeneral.res.status).toBe(200);
    expect(toGeneral.body).toMatchObject({ type: "general", institutions: [], divisions: [] });
  });

  test("an edit racing another one is refused", async () => {
    const { body } = await send("tech", "POST", "/", sportEvent());
    const id = body.id as string;
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`update event set version = version + 1 where id = '${id}'`);
    };
    const res = await send("tech", "PUT", `/${id}`, { ...sportEvent({ name: "x" }), version: 1 });
    expect(res.res.status).toBe(409);
  });

  test("only catalog managers edit and delete", async () => {
    const { body } = await send("tech", "POST", "/", sportEvent());
    const id = body.id as string;
    expect(
      (await send("reg-kmutt", "PUT", `/${id}`, { ...sportEvent(), version: 1 })).res.status,
    ).toBe(403);
    expect((await send("reg-staff", "DELETE", `/${id}`)).res.status).toBe(403);
    expect((await send("admin", "DELETE", `/${id}`)).res.status).toBe(200);
    const links = await t.db.select().from(eventDivision).where(eq(eventDivision.eventId, id));
    expect(links).toEqual([]);
  });
});
