import { beforeEach, describe, expect, test } from "bun:test";
import {
  TICKET_CODE_PATTERN,
  event,
  eventCheckin,
  eventDivision,
  eventInstitution,
  eventTicket,
  sportRegistration,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { createTicketRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createTicketRoutes>;

const HOUR = 60 * 60 * 1000;

type Ticket = { id: string; code: string; event: { id: string }; checkedInAt: string | null };
type OpenEvent = {
  id: string;
  claimed: boolean;
  remaining: number | null;
  sports: { name: string; icon: string }[];
};

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

const claim = (userId: string, eventRef: string) =>
  send<{ ticket: Ticket; code?: string }>(userId, "POST", `/events/${eventRef}`, {});

describe("claiming", () => {
  test("any account claims a general event's ticket, once", async () => {
    const first = await claim("guest", "e-general");
    expect(first.res.status).toBe(201);
    expect(first.body.ticket.event.id).toBe("e-general");
    expect(first.body.ticket.code).toMatch(TICKET_CODE_PATTERN);
    expect(first.body.ticket.checkedInAt).toBeNull();

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
        `insert into event_ticket (id, event_id, user_id, code) values ('t-0', 'e-general', 'guest-2', '${"x".repeat(32)}')`,
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
      t.as(null, { method: "POST", json: {} }),
    );
    expect(anonymous.status).toBe(401);
    const notJson = await app.request("/events/e-general", t.as("guest", { method: "POST" }));
    expect(notJson.status).toBe(415);
    expect(await t.db.select().from(eventTicket)).toEqual([]);
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
    const guest = await send<{ items: OpenEvent[] }>("guest", "GET", "/events");
    expect(guest.body.items).toMatchObject([{ id: "e-general", claimed: false, remaining: 4 }]);
  });

  test("an account lists its own tickets with their check-in", async () => {
    await claim("athlete", "e-general");
    await claim("athlete", "e-sport");
    await claim("guest", "e-general");
    await t.db
      .insert(eventCheckin)
      .values({ eventId: "e-sport", userId: "athlete", method: "scan" });
    const { body } = await send<{ items: Ticket[] }>("athlete", "GET", "/");
    expect(body.items.map((item) => item.event.id).sort()).toEqual(["e-general", "e-sport"]);
    const sport = body.items.find((item) => item.event.id === "e-sport");
    expect(typeof sport?.checkedInAt).toBe("string");
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
      .values({ eventId: "e-general", userId: "guest", method: "scan" });
    const refused = await send("guest", "DELETE", `/${body.ticket.id}`);
    expect(refused.res.status).toBe(409);
    expect(await t.db.select().from(eventTicket)).toHaveLength(1);
  });

  test("a check-in landing meanwhile keeps the ticket", async () => {
    const { body } = await claim("guest", "e-general");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event_checkin (id, event_id, user_id, method) values ('c-0', 'e-general', 'guest', 'scan')`,
      );
    };
    expect((await send("guest", "DELETE", `/${body.ticket.id}`)).res.status).toBe(409);
    expect(await t.db.select().from(eventTicket)).toHaveLength(1);
  });
});
