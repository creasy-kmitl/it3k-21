import { beforeEach, describe, expect, test } from "bun:test";
import {
  TICKET_CODE_PATTERN,
  event,
  eventCheckin,
  eventDivision,
  eventInstitution,
  eventTicket,
  eventTicketType,
  sportRegistration,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { createTicketRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createTicketRoutes>;

const HOUR = 60 * 60 * 1000;

type Ticket = {
  id: string;
  code: string;
  event: { id: string };
  ticketType: { id: string; name: string } | null;
  checkedInAt: string | null;
};
type OpenEvent = {
  id: string;
  claimed: boolean;
  remaining: number | null;
  sports: { name: string; icon: string }[];
  ticketTypes: { id: string; canClaim: boolean; refusal: string | null; held: number }[];
};

/** Each event's one ticket type, as the setup makes them. */
const TYPE: Record<string, string> = {
  "e-general": "tt-general",
  opening: "tt-general",
  "e-sport": "tt-sport",
  "e-closed": "tt-closed",
  "e-over": "tt-over",
};
let footballSport: string;

beforeEach(async () => {
  t = createTestContext();
  app = createTicketRoutes(t.deps);
  await t.seedUser("guest", { role: "guest" });
  await t.seedUser("guest-2", { role: "guest" });
  await t.seedUser("staff", { department: "Tech/Live" });
  await t.seedParticipant("athlete", "kmitl");
  await t.seedParticipant("outsider", "kmutt");
  const football = await t.divisionId("football");
  await t.db.insert(sportRegistration).values([
    {
      userId: "athlete",
      divisionId: football,
      institution: "kmitl",
      shirtNumber: 7,
      status: "approved",
    },
    // Approved, but kmutt is not invited.
    {
      userId: "outsider",
      divisionId: football,
      institution: "kmutt",
      shirtNumber: 8,
      status: "approved",
    },
  ]);
  const now = Date.now();
  await t.db.insert(event).values([
    {
      id: "e-general",
      type: "general",
      name: "พิธีเปิด",
      slug: "opening",
      startAt: new Date(now + HOUR),
      endAt: new Date(now + 3 * HOUR),
      ticketsOpen: true,
    },
    {
      id: "e-sport",
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
  await t.db.insert(eventInstitution).values({ eventId: "e-sport", institution: "kmitl" });
  await t.db.insert(eventDivision).values({ eventId: "e-sport", divisionId: football });
  await t.db.insert(eventTicketType).values([
    { id: "tt-general", eventId: "e-general", name: "ทั่วไป" },
    { id: "tt-sport", eventId: "e-sport", name: "นักกีฬา", listedOnly: true },
    { id: "tt-closed", eventId: "e-closed", name: "ทั่วไป" },
    { id: "tt-over", eventId: "e-over", name: "ทั่วไป" },
  ]);
  const [row] = t.sqlite
    .query<{ id: string }, [string]>("select sport_id as id from sport_division where id = ?")
    .all(football);
  footballSport = row?.id ?? "";
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

const claim = (userId: string, eventRef: string, ticketTypeId = TYPE[eventRef] ?? "nope") =>
  send<{ ticket: Ticket; code?: string }>(userId, "POST", `/events/${eventRef}`, { ticketTypeId });

const addType = (
  id: string,
  eventId: string,
  values: Partial<typeof eventTicketType.$inferInsert>,
) => t.db.insert(eventTicketType).values({ id, eventId, name: id, ...values });

describe("claiming", () => {
  test("any account claims a general event's ticket, once", async () => {
    const first = await claim("guest", "e-general");
    expect(first.res.status).toBe(201);
    expect(first.body.ticket.event.id).toBe("e-general");
    expect(first.body.ticket.code).toMatch(TICKET_CODE_PATTERN);
    expect(first.body.ticket.checkedInAt).toBeNull();
    expect(first.body.ticket.ticketType).toEqual({ id: "tt-general", name: "ทั่วไป" });

    const again = await claim("guest", "opening");
    expect(again.res.status).toBe(200);
    expect(again.body.ticket.id).toBe(first.body.ticket.id);
    expect(await t.db.select().from(eventTicket)).toHaveLength(1);
  });

  test("a sport event's ticket goes only to athletes it expects", async () => {
    const outsider = await claim("outsider", "e-sport");
    expect(outsider.res.status).toBe(409);
    expect(outsider.body.code).toBe("not-listed");
    expect((await claim("staff", "e-sport")).body.code).toBe("not-listed");
    expect((await claim("athlete", "e-sport")).res.status).toBe(201);
  });

  test("a closed or finished event takes no claims", async () => {
    expect((await claim("guest", "e-closed")).body.code).toBe("closed");
    expect((await claim("guest", "e-over")).body.code).toBe("closed");
    expect((await claim("guest", "nope")).res.status).toBe(404);
    // A type of another event is not this event's.
    expect((await claim("guest", "e-general", "tt-closed")).res.status).toBe(404);
    expect((await send("guest", "POST", "/events/e-general", {})).res.status).toBe(400);
  });

  test("a full event takes no more claims", async () => {
    await t.db.update(event).set({ ticketCapacity: 1 }).where(eq(event.id, "e-general"));
    expect((await claim("guest", "e-general")).res.status).toBe(201);
    const full = await claim("guest-2", "e-general");
    expect(full.res.status).toBe(409);
    expect(full.body.code).toBe("full");
  });

  test("the last seat taken meanwhile reports the event full", async () => {
    await t.db.update(event).set({ ticketCapacity: 1 }).where(eq(event.id, "e-general"));
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event_ticket (id, event_id, ticket_type_id, user_id, code) values ('t-0', 'e-general', 'tt-general', 'guest-2', '${"x".repeat(32)}')`,
      );
    };
    const { res, body } = await claim("guest", "e-general");
    expect(res.status).toBe(409);
    expect(body.code).toBe("full");
    const rows = await t.db.select().from(eventTicket);
    expect(rows.map((row) => row.userId)).toEqual(["guest-2"]);
  });

  test("tickets closed meanwhile report the event closed", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update event set tickets_open = 0 where id = 'e-general'`);
    };
    const { res, body } = await claim("guest", "e-general");
    expect(res.status).toBe(409);
    expect(body.code).toBe("closed");
  });

  test("claims need a signed-in account and a JSON body", async () => {
    const anonymous = await app.request(
      "/events/e-general",
      t.as(null, { method: "POST", json: { ticketTypeId: "tt-general" } }),
    );
    expect(anonymous.status).toBe(401);
    const notJson = await app.request("/events/e-general", t.as("guest", { method: "POST" }));
    expect(notJson.status).toBe(415);
    expect(await t.db.select().from(eventTicket)).toEqual([]);
  });
});

describe("ticket types", () => {
  test("a type allowing several per person hands out several, up to its limit", async () => {
    await t.db
      .update(eventTicketType)
      .set({ maxPerUser: 2 })
      .where(eq(eventTicketType.id, "tt-general"));
    const first = await claim("guest", "e-general");
    const second = await claim("guest", "e-general");
    expect([first.res.status, second.res.status]).toEqual([201, 201]);
    expect(second.body.ticket.id).not.toBe(first.body.ticket.id);
    const third = await claim("guest", "e-general");
    expect(third.res.status).toBe(409);
    expect(third.body.code).toBe("limit");
    expect(await t.db.select().from(eventTicket)).toHaveLength(2);
  });

  test("each type has its own seats and switch, under the event's total", async () => {
    await addType("tt-vip", "e-general", { capacity: 1 });
    await addType("tt-shut", "e-general", { open: false });
    expect((await claim("guest", "e-general", "tt-vip")).res.status).toBe(201);
    expect((await claim("guest-2", "e-general", "tt-vip")).body.code).toBe("full");
    expect((await claim("guest-2", "e-general", "tt-shut")).body.code).toBe("type-closed");
    await t.db.update(event).set({ ticketCapacity: 2 }).where(eq(event.id, "e-general"));
    expect((await claim("guest-2", "e-general")).res.status).toBe(201);
    expect((await claim("staff", "e-general")).body.code).toBe("full");
  });

  test("roles, institutions and sports limit who may claim", async () => {
    await addType("tt-staff", "e-general", { allowedRoles: ["staff", "admin"] });
    await addType("tt-kmutt", "e-general", { allowedInstitutions: ["kmutt"] });
    await addType("tt-football", "e-general", { allowedSportIds: [footballSport] });
    await addType("tt-both", "e-general", {
      allowedRoles: ["participant"],
      allowedInstitutions: ["kmitl"],
    });
    expect((await claim("guest", "e-general", "tt-staff")).body.code).toBe("not-eligible");
    expect((await claim("staff", "e-general", "tt-staff")).res.status).toBe(201);
    expect((await claim("athlete", "e-general", "tt-kmutt")).body.code).toBe("not-eligible");
    expect((await claim("outsider", "e-general", "tt-kmutt")).res.status).toBe(201);
    expect((await claim("guest", "e-general", "tt-football")).body.code).toBe("not-eligible");
    expect((await claim("outsider", "e-general", "tt-football")).res.status).toBe(201);
    // Every kind of rule set must pass.
    expect((await claim("outsider", "e-general", "tt-both")).body.code).toBe("not-eligible");
    expect((await claim("athlete", "e-general", "tt-both")).res.status).toBe(201);
  });

  test("a rule broken meanwhile refuses the claim", async () => {
    await addType("tt-staff", "e-general", { allowedRoles: ["staff"] });
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update user set role = 'guest' where id = 'staff'`);
    };
    const { res, body } = await claim("staff", "e-general", "tt-staff");
    expect(res.status).toBe(409);
    expect(body.code).toBe("not-eligible");
    expect(await t.db.select().from(eventTicket)).toEqual([]);
  });

  test("a second ticket taken meanwhile in another tab stops at the limit", async () => {
    await t.db
      .update(eventTicketType)
      .set({ maxPerUser: 2 })
      .where(eq(eventTicketType.id, "tt-general"));
    await claim("guest", "e-general");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event_ticket (id, event_id, ticket_type_id, user_id, code) values ('t-tab', 'e-general', 'tt-general', 'guest', '${"z".repeat(32)}')`,
      );
    };
    const { res, body } = await claim("guest", "e-general");
    expect(res.status).toBe(409);
    expect(body.code).toBe("limit");
  });

  test("a spectator type opens a sport event to everyone", async () => {
    expect((await send("guest", "GET", "/events/e-sport")).res.status).toBe(404);
    await addType("tt-fans", "e-sport", {});
    const page = await send<OpenEvent>("guest", "GET", "/events/e-sport");
    expect(page.res.status).toBe(200);
    expect(page.body.ticketTypes).toMatchObject([
      { id: "tt-sport", canClaim: false, refusal: "not-listed" },
      { id: "tt-fans", canClaim: true, refusal: null },
    ]);
    expect((await claim("guest", "e-sport", "tt-fans")).res.status).toBe(201);
  });
});

describe("listing", () => {
  test("open events show what each account can claim", async () => {
    await t.db.update(event).set({ ticketCapacity: 5 }).where(eq(event.id, "e-general"));
    await claim("athlete", "e-general");
    const athlete = await send<{ items: OpenEvent[] }>("athlete", "GET", "/events");
    expect(athlete.body.items).toMatchObject([
      { id: "e-general", claimed: true, remaining: 4 },
      { id: "e-sport", claimed: false, remaining: null },
    ]);
    expect(athlete.body.items[0]).toMatchObject({ sports: [] });
    expect(athlete.body.items[1]).toMatchObject({
      sports: [{ name: "กีฬาฟุตบอล", icon: "football" }],
    });
    expect(athlete.body.items[0]?.ticketTypes).toMatchObject([
      { id: "tt-general", held: 1, canClaim: false, refusal: "limit" },
    ]);
    const guest = await send<{ items: OpenEvent[] }>("guest", "GET", "/events");
    expect(guest.body.items).toMatchObject([{ id: "e-general", claimed: false, remaining: 4 }]);
  });

  test("an account lists its own tickets with their check-in", async () => {
    await claim("athlete", "e-general");
    const { body: sportTicket } = await claim("athlete", "e-sport");
    await claim("guest", "e-general");
    await t.db.insert(eventCheckin).values({
      eventId: "e-sport",
      userId: "athlete",
      ticketId: sportTicket.ticket.id,
      method: "scan",
    });
    const { body } = await send<{ items: Ticket[] }>("athlete", "GET", "/");
    expect(body.items.map((item) => item.event.id).sort()).toEqual(["e-general", "e-sport"]);
    const sport = body.items.find((item) => item.event.id === "e-sport");
    expect(typeof sport?.checkedInAt).toBe("string");
    expect(body.items.find((item) => item.event.id === "e-general")?.checkedInAt).toBeNull();
  });
});

describe("one event", () => {
  type Detail = {
    id: string;
    open: boolean;
    claimed: boolean;
    tickets: { id: string; ticketType: { id: string; name: string }; checkedInAt: string | null }[];
  };

  test("shows an event by id or slug, with the caller's ticket", async () => {
    const before = await send<Detail>("guest", "GET", "/events/opening");
    expect(before.res.status).toBe(200);
    expect(before.body).toMatchObject({
      id: "e-general",
      open: true,
      claimed: false,
      tickets: [],
    });
    const { body: claimed } = await claim("guest", "e-general");
    const after = await send<Detail>("guest", "GET", "/events/e-general");
    expect(after.body).toMatchObject({
      claimed: true,
      tickets: [
        {
          id: claimed.ticket.id,
          ticketType: { id: "tt-general", name: "ทั่วไป" },
          checkedInAt: null,
        },
      ],
    });
    // The QR code stays on the ticket's own page.
    expect(after.body.tickets[0]).not.toHaveProperty("code");
    // Someone else sees no ticket of theirs.
    expect((await send<Detail>("guest-2", "GET", "/events/e-general")).body.tickets).toEqual([]);
  });

  test("the ticket's own page carries its code, for its holder only", async () => {
    type Held = { tickets: { id: string; code: string; event: { id: string } }[] };
    expect((await send("guest", "GET", "/events/opening/ticket")).res.status).toBe(404);
    const { body: claimed } = await claim("guest", "e-general");
    for (const ref of ["opening", "e-general"]) {
      const held = await send<Held>("guest", "GET", `/events/${ref}/ticket`);
      expect(held.res.status).toBe(200);
      expect(held.body.tickets).toMatchObject([
        { id: claimed.ticket.id, code: claimed.ticket.code, event: { id: "e-general" } },
      ]);
    }
    const other = await send<{ code: string }>("guest-2", "GET", "/events/opening/ticket");
    expect(other.res.status).toBe(404);
    expect(other.body.code).toBe("no-ticket");
  });

  test("closed and finished events still show, as not open", async () => {
    expect((await send<Detail>("guest", "GET", "/events/e-closed")).body.open).toBe(false);
    expect((await send<Detail>("guest", "GET", "/events/e-over")).body.open).toBe(false);
  });

  test("a sport event shows only to athletes it expects, or ticket holders", async () => {
    expect((await send("outsider", "GET", "/events/e-sport")).res.status).toBe(404);
    expect((await send("athlete", "GET", "/events/e-sport")).res.status).toBe(200);
    // A ticket outlives a registration withdrawn later.
    await claim("athlete", "e-sport");
    await t.db.delete(sportRegistration).where(eq(sportRegistration.userId, "athlete"));
    const held = await send<Detail>("athlete", "GET", "/events/e-sport");
    expect(held.res.status).toBe(200);
    expect(held.body.claimed).toBe(true);
    expect((await send("guest", "GET", "/events/nope")).res.status).toBe(404);
  });
});

describe("cancelling", () => {
  test("a holder hands a ticket back and may claim again", async () => {
    const { body } = await claim("guest", "e-general");
    const ticketId = body.ticket.id;
    expect((await send("guest-2", "DELETE", `/${ticketId}`)).res.status).toBe(404);
    expect((await send("guest", "DELETE", `/${ticketId}`)).res.status).toBe(200);
    expect(await t.db.select().from(eventTicket)).toEqual([]);
    expect((await send("guest", "DELETE", `/${ticketId}`)).res.status).toBe(404);
    expect((await claim("guest", "e-general")).res.status).toBe(201);
  });

  test("a ticket already used to check in cannot be handed back", async () => {
    const { body } = await claim("guest", "e-general");
    await t.db
      .insert(eventCheckin)
      .values({ eventId: "e-general", userId: "guest", ticketId: body.ticket.id, method: "scan" });
    const refused = await send("guest", "DELETE", `/${body.ticket.id}`);
    expect(refused.res.status).toBe(409);
    expect(await t.db.select().from(eventTicket)).toHaveLength(1);
  });

  test("a check-in landing meanwhile keeps the ticket", async () => {
    const { body } = await claim("guest", "e-general");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event_checkin (id, event_id, user_id, ticket_id, method) values ('c-0', 'e-general', 'guest', '${body.ticket.id}', 'scan')`,
      );
    };
    expect((await send("guest", "DELETE", `/${body.ticket.id}`)).res.status).toBe(409);
    expect(await t.db.select().from(eventTicket)).toHaveLength(1);
  });
});
