import { beforeEach, describe, expect, test } from "bun:test";
import { eventDivision, eventTicket, eventTicketType, venue } from "@it3k/db/schema/index";
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
  slug: string | null;
  version: number;
  venue: { id: string; name: string } | null;
  institutions: string[];
  divisions: { id: string; name: string; sportName: string; icon: string }[];
  ticketTypes: { id: string; name: string; ticketCount: number; maxPerUser: number }[];
};

const doc = (...lines: string[]) => ({
  type: "doc",
  content: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const ticketType = (overrides: Record<string, unknown> = {}) => ({
  name: "ทั่วไป",
  description: "",
  capacity: null,
  maxPerUser: 1,
  open: true,
  listedOnly: false,
  allowedRoles: [],
  allowedInstitutions: [],
  allowedSportIds: [],
  ...overrides,
});

function sportEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "sport",
    name: "ฟุตบอลรอบแรก",
    content: null,
    startAt: DAY,
    endAt: DAY + 3 * HOUR,
    venueId,
    thumbnailUrl: "",
    ticketsOpen: false,
    ticketCapacity: null,
    institutions: ["kmitl", "kmutt"],
    divisionIds: [football],
    ticketTypes: [ticketType({ listedOnly: true })],
    ...overrides,
  };
}

const general = (overrides: Record<string, unknown> = {}) => ({
  type: "general",
  name: "พิธีเปิด",
  content: doc("เปิดงาน"),
  startAt: DAY - 24 * HOUR,
  endAt: DAY - 22 * HOUR,
  venueId: null,
  thumbnailUrl: "",
  ticketsOpen: false,
  ticketCapacity: null,
  institutions: [],
  divisionIds: [],
  ticketTypes: [ticketType()],
  ...overrides,
});

beforeEach(async () => {
  t = createTestContext();
  app = createEventRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live", seat: "head", institution: "kmitl" });
  await t.seedUser("tech-staff", { department: "Tech/Live" });
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

/** Creates an event from its name and slug, then saves `full` over the draft. */
async function make(full: Record<string, unknown>, who = "tech") {
  const draft = await send(who, "POST", "/", {
    name: full.name,
    slug: (full.slug as string | undefined) ?? "",
  });
  if (draft.res.status !== 201) return draft;
  const created = draft.body as unknown as EventBody;
  const { slug: _slug, ...rest } = full;
  return send(who, "PUT", `/${created.id}`, {
    ...rest,
    ticketTypes: (full.ticketTypes as Record<string, unknown>[]).map((type, index) =>
      index === 0 ? { ...type, id: created.ticketTypes[0]?.id } : type,
    ),
    version: 1,
  });
}

describe("creating", () => {
  test("only catalog managers create events", async () => {
    for (const who of ["reg-staff", "reg-kmutt", "art", "athlete"]) {
      expect((await send(who, "POST", "/", { name: "x", slug: "" })).res.status).toBe(403);
    }
    for (const who of ["admin", "tech", "reg-head"]) {
      expect((await send(who, "POST", "/", { name: "x", slug: "" })).res.status).toBe(201);
    }
  });

  test("takes a name and slug and fills in a closed general draft", async () => {
    const before = Date.now();
    const { res, body } = await send("tech", "POST", "/", { name: "Opening", slug: "" });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      type: "general",
      name: "Opening",
      slug: "opening",
      content: null,
      description: null,
      ticketsOpen: false,
      version: 1,
      institutions: [],
      divisions: [],
      ticketTypes: [{ name: "ทั่วไป", maxPerUser: 1, open: true, ticketCount: 0 }],
    });
    const start = Date.parse(body.startAt as string);
    expect(start % HOUR).toBe(0);
    expect(start).toBeGreaterThanOrEqual(before);
    expect(Date.parse(body.endAt as string) - start).toBe(2 * HOUR);
    // Nothing but the name and slug.
    expect((await send("tech", "POST", "/", { ...general(), slug: "" })).res.status).toBe(400);
  });

  test("a full save returns the venue, institutions, divisions and summary", async () => {
    const { res, body } = await make(sportEvent({ content: doc("รอบแรก", "  เตะ  เวลา 9 โมง ") }));
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      type: "sport",
      description: "รอบแรก\nเตะ เวลา 9 โมง",
      content: doc("รอบแรก", "  เตะ  เวลา 9 โมง "),
      thumbnailUrl: null,
      version: 2,
      venue: { id: venueId, name: "สนามฟุตบอลกลาง" },
      institutions: ["kmitl", "kmutt"],
      divisions: [{ name: "ฟุตบอล", sportName: "กีฬาฟุตบอล", icon: "football" }],
    });
  });

  test("checks times, links, content and ticket types", async () => {
    const bad = [
      sportEvent({ endAt: DAY }),
      sportEvent({ endAt: DAY + 32 * 24 * HOUR }),
      sportEvent({ institutions: [] }),
      sportEvent({ divisionIds: [] }),
      sportEvent({ institutions: ["kmitl", "kmitl"] }),
      sportEvent({ institutions: ["harvard"] }),
      general({ institutions: ["kmitl"] }),
      general({ thumbnailUrl: "http://x.test/a.png" }),
      general({ content: { type: "doc", content: [{ type: "codeBlock" }] } }),
      general({ content: "<p>html</p>" }),
      general({ ticketTypes: [ticketType(), ticketType({ name: " ทั่วไป " })] }),
      general({ ticketTypes: [ticketType({ listedOnly: true })] }),
      general({ ticketTypes: [ticketType({ capacity: 1, maxPerUser: 2 })] }),
      general({ ticketTypes: [ticketType({ maxPerUser: 0 })] }),
      general({ ticketTypes: [ticketType({ allowedRoles: ["root"] })] }),
      general({ ticketsOpen: true, ticketTypes: [ticketType({ open: false })] }),
      general({ ticketsOpen: true, ticketTypes: [] }),
    ];
    for (const json of bad) {
      expect((await make(json)).res.status, JSON.stringify(json).slice(0, 200)).toBe(400);
    }
    expect((await make(general())).res.status).toBe(200);
  });

  test("an unknown venue or division is refused", async () => {
    const venueGone = await make(sportEvent({ venueId: "nope" }));
    expect(venueGone.res.status).toBe(400);
    expect(venueGone.body.message).toBe("ไม่พบสถานที่หรือประเภทกีฬาที่เลือก กรุณาโหลดใหม่");
    expect((await make(sportEvent({ divisionIds: ["nope"] }))).res.status).toBe(400);
  });
});

describe("ticket types", () => {
  test("are updated by id, added without one and removed when left out", async () => {
    const { body } = await make(general());
    const event = body as unknown as EventBody;
    const first = defined(event.ticketTypes[0]);
    const both = await send("tech", "PUT", `/${event.id}`, {
      ...general({
        ticketTypes: [
          ticketType({ name: "VIP", capacity: 10, maxPerUser: 2, allowedRoles: ["staff"] }),
          ticketType({ id: first.id, name: "ผู้ชม" }),
        ],
      }),
      version: 2,
    });
    expect(both.res.status).toBe(200);
    const types = (both.body as unknown as EventBody).ticketTypes;
    expect(types.map((type) => type.name)).toEqual(["VIP", "ผู้ชม"]);
    expect(types[1]?.id).toBe(first.id);
    expect(types[0]).toMatchObject({ capacity: 10, maxPerUser: 2, allowedRoles: ["staff"] });

    const vip = defined(types[0]).id;
    const one = await send("tech", "PUT", `/${event.id}`, {
      ...general({ ticketTypes: [ticketType({ id: vip, name: "VIP" })] }),
      version: 3,
    });
    expect((one.body as unknown as EventBody).ticketTypes.map((type) => type.id)).toEqual([vip]);
  });

  test("a type with tickets cannot be removed, nor one from another event", async () => {
    const { body } = await make(general());
    const event = body as unknown as EventBody;
    const typeId = defined(event.ticketTypes[0]).id;
    await t.db
      .insert(eventTicket)
      .values({ eventId: event.id, ticketTypeId: typeId, userId: "art", code: "x".repeat(32) });
    const removed = await send("tech", "PUT", `/${event.id}`, {
      ...general({ ticketTypes: [ticketType({ name: "ใหม่" })] }),
      version: 2,
    });
    expect(removed.res.status).toBe(409);
    expect(removed.body.message).toBe("ลบประเภทตั๋วที่มีคนรับแล้วไม่ได้");

    const other = await make(general({ name: "Other" }));
    const stolen = await send("tech", "PUT", `/${(other.body as unknown as EventBody).id}`, {
      ...general({ name: "Other", ticketTypes: [ticketType({ id: typeId })] }),
      version: 2,
    });
    expect(stolen.res.status).toBe(409);
    expect(await t.db.select().from(eventTicketType).where(eq(eventTicketType.id, typeId))).toHaveLength(1);
  });

  test("a ticket claimed meanwhile keeps its type from being removed", async () => {
    const { body } = await make(general());
    const event = body as unknown as EventBody;
    const typeId = defined(event.ticketTypes[0]).id;
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event_ticket (id, event_id, ticket_type_id, user_id, code) values ('raced', '${event.id}', '${typeId}', 'art', '${"y".repeat(32)}')`,
      );
    };
    const removed = await send("tech", "PUT", `/${event.id}`, {
      ...general({ ticketTypes: [ticketType({ name: "ใหม่" })] }),
      version: 2,
    });
    expect(removed.res.status).toBe(409);
    expect(removed.body.message).toBe("ลบประเภทตั๋วที่มีคนรับแล้วไม่ได้");
  });
});

describe("reading", () => {
  test("members list events in start order and filter them", async () => {
    await make(sportEvent());
    await make(general());
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
    const { body } = await make(sportEvent());
    const one = await send("reg-staff", "GET", `/${body.id as string}`);
    expect(one.res.status).toBe(200);
    expect(one.body).toMatchObject({ id: body.id, canManage: false });
    expect((await send("reg-staff", "GET", "/nope")).res.status).toBe(404);
  });
});

describe("editing", () => {
  test("replaces the institutions and divisions, with a version guard", async () => {
    const { body } = await make(sportEvent());
    const id = body.id as string;
    const edited = await send("tech", "PUT", `/${id}`, {
      ...sportEvent({
        institutions: ["kmutnb-bangkok"],
        divisionIds: [basketball, football],
      }),
      version: 2,
    });
    expect(edited.res.status).toBe(200);
    expect(edited.body).toMatchObject({ version: 3, institutions: ["kmutnb-bangkok"] });
    expect((edited.body as unknown as EventBody).divisions).toHaveLength(2);

    const stale = await send("tech", "PUT", `/${id}`, { ...sportEvent(), version: 2 });
    expect(stale.res.status).toBe(409);

    const toGeneral = await send("tech", "PUT", `/${id}`, { ...general(), version: 3 });
    expect(toGeneral.res.status).toBe(200);
    expect(toGeneral.body).toMatchObject({ type: "general", institutions: [], divisions: [] });
  });

  test("an edit racing another one is refused", async () => {
    const { body } = await make(sportEvent());
    const id = body.id as string;
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`update event set version = version + 1 where id = '${id}'`);
    };
    const res = await send("tech", "PUT", `/${id}`, { ...sportEvent({ name: "x" }), version: 2 });
    expect(res.res.status).toBe(409);
  });

  test("only catalog managers edit and delete", async () => {
    const { body } = await make(sportEvent());
    const id = body.id as string;
    expect(
      (await send("reg-kmutt", "PUT", `/${id}`, { ...sportEvent(), version: 2 })).res.status,
    ).toBe(403);
    expect((await send("reg-staff", "DELETE", `/${id}`)).res.status).toBe(403);
    expect((await send("admin", "DELETE", `/${id}`)).res.status).toBe(200);
    const links = await t.db.select().from(eventDivision).where(eq(eventDivision.eventId, id));
    expect(links).toEqual([]);
  });
});

describe("slugs", () => {
  const create = async (overrides: { name?: string; slug?: string }) => {
    const { res, body } = await send("tech", "POST", "/", {
      name: overrides.name ?? "ฟุตบอลรอบแรก",
      slug: overrides.slug ?? "",
    });
    return { status: res.status, event: body as unknown as EventBody, body };
  };
  /** Saves the event as `sportEvent(overrides)`, with "" for its slug: made again. */
  const remake = async (id: string, version: number, overrides: Record<string, unknown>) => {
    const current = (await send("tech", "GET", `/${id}`)).body as unknown as EventBody;
    const { body } = await send("tech", "PUT", `/${id}`, {
      ...sportEvent({ ticketTypes: [ticketType({ id: current.ticketTypes[0]?.id, listedOnly: true })] }),
      ...overrides,
      slug: "",
      version,
    });
    return body as unknown as EventBody;
  };

  test("a new event gets a slug from its name, with a suffix when taken", async () => {
    expect((await create({ name: "IT3K Football Round 1" })).event.slug).toBe(
      "it3k-football-round-1",
    );
    expect((await create({ name: "IT3K football: round 1!" })).event.slug).toBe(
      "it3k-football-round-1-2",
    );
    expect((await create({ name: "IT3K Football Round 1", slug: "" })).event.slug).toBe(
      "it3k-football-round-1-3",
    );
  });

  test("a Thai name keeps its Latin part, or falls back to type and Bangkok date", async () => {
    expect((await create({ name: "ฟุตบอล IT3K ๒๕๖๙" })).event.slug).toBe("it3k-2569");
    // 2026-12-05 02:00 UTC is 09:00 in Bangkok.
    const first = (await create({ name: "ฟุตบอลรอบแรก" })).event;
    expect((await remake(first.id, 1, { name: "ฟุตบอลรอบแรก" })).slug).toBe("sport-2026-12-05");
    const second = (await create({ name: "ฟุตบอลรอบสอง" })).event;
    expect((await remake(second.id, 1, { name: "ฟุตบอลรอบสอง" })).slug).toBe("sport-2026-12-05-2");
    const evening = (await create({ name: "พิธีปิด" })).event;
    const general2 = await remake(evening.id, 1, {
      ...general({ name: "พิธีปิด", startAt: Date.UTC(2026, 11, 5, 18), endAt: Date.UTC(2026, 11, 5, 20) }),
      ticketTypes: [ticketType({ id: evening.ticketTypes[0]?.id })],
    });
    expect(general2.slug).toBe("general-2026-12-06");
  });

  test("a typed slug is used as it is, and refused when taken", async () => {
    expect((await create({ slug: "opening-day" })).event.slug).toBe("opening-day");
    const taken = await create({ slug: "opening-day" });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toBe("ลิงก์นี้มีกิจกรรมอื่นใช้แล้ว ลองตั้งลิงก์อื่น");
  });

  test("checks the slug's format", async () => {
    for (const slug of [
      "Opening",
      "เปิดงาน",
      "a b",
      "-start",
      "end-",
      "two--hyphens",
      "ab",
      "a".repeat(65),
      "2f1c7e0a-6b1d-4c8e-9f3a-0123456789ab",
    ]) {
      const { status, body } = await create({ slug });
      expect(status, slug).toBe(400);
      expect((body.issues as { path: string[] }[])[0]?.path).toEqual(["slug"]);
    }
  });

  test("events are read by slug as well as by id", async () => {
    const { event } = await create({ slug: "final" });
    for (const ref of [event.id, "final"]) {
      const { res, body } = await send("art", "GET", `/${ref}`);
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ id: event.id, slug: "final" });
    }
    expect((await send("art", "GET", "/nope")).res.status).toBe(404);
  });

  test("an edit keeps, changes or remakes the slug", async () => {
    const { event } = await create({ name: "Semi Final" });
    expect(event.slug).toBe("semi-final");
    await create({ slug: "taken" });

    const typeId = event.ticketTypes[0]?.id;
    const put = (version: number, overrides: Record<string, unknown>) =>
      send("tech", "PUT", `/${event.id}`, {
        ...sportEvent({ ticketTypes: [ticketType({ id: typeId, listedOnly: true })], ...overrides }),
        version,
      });
    // Omitted: kept, even though the name changed.
    const kept = await put(1, { name: "Grand Final" });
    expect(kept.body).toMatchObject({ slug: "semi-final", version: 2 });
    // The event's own slug is not a clash.
    expect((await put(2, { name: "Grand Final", slug: "semi-final" })).res.status).toBe(200);
    expect((await put(3, { name: "Grand Final", slug: "taken" })).res.status).toBe(409);
    expect((await put(3, { name: "Grand Final", slug: "grand" })).body).toMatchObject({
      slug: "grand",
      version: 4,
    });
    // "": made again from the name.
    expect((await put(4, { name: "Grand Final", slug: "" })).body).toMatchObject({
      slug: "grand-final",
    });
  });

  test("an event made before slugs gets one when next saved", async () => {
    const { event } = await create({ name: "Old Event" });
    t.sqlite.run(`update event set slug = null where id = '${event.id}'`);
    const { body } = await send("tech", "PUT", `/${event.id}`, {
      ...sportEvent({
        name: "Old Event",
        ticketTypes: [ticketType({ id: event.ticketTypes[0]?.id, listedOnly: true })],
      }),
      version: 1,
    });
    expect(body).toMatchObject({ slug: "old-event" });
  });

  test("a generated slug taken meanwhile moves on to the next free one", async () => {
    let raced = false;
    t.hooks.beforeBatch = () => {
      if (raced) return;
      raced = true;
      t.sqlite.run(
        `insert into event (id, type, name, slug, start_at, end_at) values ('other', 'general', 'x', 'race-day', ${DAY}, ${DAY + HOUR})`,
      );
    };
    const { status, event } = await create({ name: "Race Day" });
    expect(status).toBe(201);
    expect(event.slug).toBe("race-day-2");
  });

  test("a typed slug taken meanwhile is refused", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event (id, type, name, slug, start_at, end_at) values ('other', 'general', 'x', 'mine', ${DAY}, ${DAY + HOUR})`,
      );
    };
    expect((await create({ slug: "mine" })).status).toBe(409);
    const { event } = await create({ name: "Semi Final" });
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update event set slug = 'later' where id = 'other'`);
    };
    const edit = await send("tech", "PUT", `/${event.id}`, {
      ...sportEvent({
        slug: "later",
        ticketTypes: [ticketType({ id: event.ticketTypes[0]?.id, listedOnly: true })],
      }),
      version: 1,
    });
    expect(edit.res.status).toBe(409);
    expect(edit.body.message).toBe("ลิงก์นี้มีกิจกรรมอื่นใช้แล้ว ลองตั้งลิงก์อื่น");
  });
});
