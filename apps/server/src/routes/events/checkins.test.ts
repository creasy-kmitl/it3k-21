import { beforeEach, describe, expect, test } from "bun:test";
import {
  athlete,
  event,
  eventCheckin,
  eventDivision,
  eventInstitution,
  eventTicket,
  eventTicketType,
  sportRegistration,
  user,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { createEventRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createEventRoutes>;

const START = new Date(Date.UTC(2026, 11, 5, 2));
const END = new Date(Date.UTC(2026, 11, 5, 5));

type Participant = {
  userId: string;
  institution: string;
  expected: boolean;
  hasTicket: boolean;
  divisions: { name: string }[];
  tickets: { id: string; typeName: string; checkin: { id: string } | null }[];
  checkins: { id: string; ticketId: string | null }[];
  checkin: { method: string; forced: boolean } | null;
};

beforeEach(async () => {
  t = createTestContext();
  app = createEventRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live", seat: "head", institution: "kmitl" });
  await t.seedUser("tech-staff", { department: "Tech/Live" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("kmutt-head", { department: "ทะเบียน", institution: "kmutt", seat: "vicehead" });
  await t.seedUser("art", { department: "Art" });
  for (const [id, institution] of [
    ["kmitl-1", "kmitl"],
    ["kmutt-1", "kmutt"],
    ["kmutnb-1", "kmutnb-bangkok"],
  ] as const) {
    await t.seedParticipant(id, institution);
    await t.db.update(user).set({ institution }).where(eq(user.id, id));
    await t.db.insert(athlete).values({ userId: id, studentId: `id-${id}` });
  }
  const football = await t.divisionId("football");
  const rov = await t.divisionId("esports-rov");
  const approved = { status: "approved" as const };
  await t.db.insert(sportRegistration).values([
    { userId: "kmitl-1", divisionId: football, institution: "kmitl", shirtNumber: 7, ...approved },
    { userId: "kmutt-1", divisionId: football, institution: "kmutt", shirtNumber: 7, ...approved },
    // Still in review: not expected yet.
    { userId: "kmutt-1", divisionId: rov, institution: "kmutt" },
    // Approved, but kmutnb is not invited.
    {
      userId: "kmutnb-1",
      divisionId: football,
      institution: "kmutnb-bangkok",
      shirtNumber: 7,
      ...approved,
    },
  ]);
  await t.db.insert(event).values([
    {
      id: "e-sport",
      type: "sport",
      name: "ฟุตบอล",
      slug: "football-r1",
      startAt: START,
      endAt: END,
    },
    { id: "e-general", type: "general", name: "พิธีเปิด", startAt: START, endAt: END },
  ]);
  await t.db.insert(eventInstitution).values([
    { eventId: "e-sport", institution: "kmitl" },
    { eventId: "e-sport", institution: "kmutt" },
  ]);
  await t.db.insert(eventDivision).values([
    { eventId: "e-sport", divisionId: football },
    { eventId: "e-sport", divisionId: rov },
  ]);
  await t.db.insert(eventTicketType).values([
    { id: "tt-sport", eventId: "e-sport", name: "นักกีฬา", listedOnly: true },
    { id: "tt-fans", eventId: "e-sport", name: "ผู้ชม", maxPerUser: 2, sortOrder: 1 },
    { id: "tt-general", eventId: "e-general", name: "ทั่วไป" },
  ]);
  // The expected athletes have claimed their tickets.
  await t.db
    .insert(eventTicket)
    .values([
      ticket("t-kmitl-1", "e-sport", "kmitl-1", "tt-sport"),
      ticket("t-kmutt-1", "e-sport", "kmutt-1", "tt-sport"),
    ]);
});

function ticket(id: string, eventId: string, userId: string, ticketTypeId: string) {
  return { id, eventId, userId, ticketTypeId, code: code(id) };
}

/** A well-formed ticket code, made readable for the test. */
function code(name: string) {
  return name.replaceAll(/[^A-Za-z0-9]/g, "").padEnd(32, "x");
}

async function send<T = Record<string, unknown>>(
  userId: string,
  method: string,
  path: string,
  json?: unknown,
) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

const checkIn = (who: string, userId: string, extra: Record<string, unknown> = {}) =>
  send(who, "POST", "/e-sport/checkins", { userId, method: "scan", ...extra });

describe("participants", () => {
  test("a sport event expects approved athletes of its divisions and institutions", async () => {
    const { res, body } = await send<{ items: Participant[]; canCheckIn: boolean }>(
      "reg-staff",
      "GET",
      "/e-sport/participants",
    );
    expect(res.status).toBe(200);
    expect(body.items.map((item) => item.userId)).toEqual(["kmitl-1", "kmutt-1"]);
    expect(body.items[1]).toMatchObject({
      expected: true,
      hasTicket: true,
      divisions: [{ name: "ฟุตบอล" }],
      tickets: [{ id: "t-kmutt-1", typeName: "นักกีฬา", checkin: null }],
      checkins: [],
      checkin: null,
    });
    expect(body.canCheckIn).toBe(true);
  });

  test("other institutions see their own athletes only; others are refused", async () => {
    const { body } = await send<{ items: Participant[]; canCheckIn: boolean }>(
      "kmutt-head",
      "GET",
      "/e-sport/participants",
    );
    expect(body.items.map((item) => item.userId)).toEqual(["kmutt-1"]);
    expect(body.canCheckIn).toBe(false);
    expect((await send("art", "GET", "/e-sport/participants")).res.status).toBe(403);
    expect((await send("tech", "GET", "/nope/participants")).res.status).toBe(404);
  });

  test("a general event lists its ticket holders and whoever checked in", async () => {
    await t.db
      .insert(eventTicket)
      .values(ticket("g-kmutnb", "e-general", "kmutnb-1", "tt-general"));
    const general = (userId: string, extra: Record<string, unknown> = {}) =>
      send("tech", "POST", "/e-general/checkins", { userId, method: "manual", ...extra });
    expect((await general("kmutnb-1")).res.status).toBe(201);
    expect((await general("kmitl-1", { force: true })).res.status).toBe(201);
    const { body } = await send<{ items: Participant[] }>("tech", "GET", "/e-general/participants");
    expect(body.items).toMatchObject([
      {
        userId: "kmutnb-1",
        expected: true,
        hasTicket: true,
        checkin: { method: "manual", forced: false },
      },
      { userId: "kmitl-1", expected: false, hasTicket: false, checkin: { forced: true } },
    ]);
  });
});

describe("checking in", () => {
  test("kiosk operators check a ticket in once", async () => {
    const first = await checkIn("reg-staff", "kmitl-1");
    expect(first.res.status).toBe(201);
    expect(first.body).toMatchObject({
      code: "checked-in",
      forced: false,
      person: { userId: "kmitl-1", institution: "kmitl", divisions: [{ name: "ฟุตบอล" }] },
      ticket: { id: "t-kmitl-1", typeName: "นักกีฬา", index: 1, total: 1 },
    });
    const again = await checkIn("tech", "kmitl-1");
    expect(again.res.status).toBe(409);
    expect(again.body).toMatchObject({ code: "duplicate", person: { userId: "kmitl-1" } });
    expect(typeof again.body.checkedInAt).toBe("string");
    const rescanned = await send("tech", "POST", "/e-sport/checkins", {
      ticketCode: code("t-kmitl-1"),
      method: "scan",
    });
    expect(rescanned.body).toMatchObject({
      code: "duplicate",
      message: "เช็คอินไปแล้ว",
      ticket: { id: "t-kmitl-1" },
    });
  });

  test("each ticket checks in once, so two tickets let their holder in twice", async () => {
    await t.db
      .insert(eventTicket)
      .values([
        ticket("f-1", "e-sport", "kmutnb-1", "tt-fans"),
        ticket("f-2", "e-sport", "kmutnb-1", "tt-fans"),
      ]);
    // The second ticket's QR checks in that ticket.
    const second = await send("tech", "POST", "/e-sport/checkins", {
      ticketCode: code("f-2"),
      method: "scan",
    });
    expect(second.body).toMatchObject({
      code: "checked-in",
      ticket: { id: "f-2", typeName: "ผู้ชม", index: 2, total: 2 },
    });
    // The profile barcode takes the next unused one.
    const byBarcode = await checkIn("tech", "kmutnb-1");
    expect(byBarcode.body).toMatchObject({ code: "checked-in", ticket: { id: "f-1" } });
    const third = await checkIn("tech", "kmutnb-1");
    expect(third.res.status).toBe(409);
    expect(third.body).toMatchObject({ code: "duplicate", message: "ใช้ตั๋วครบทุกใบแล้ว" });

    const { body } = await send<{ items: Participant[] }>("tech", "GET", "/e-sport/participants");
    const fan = body.items.find((item) => item.userId === "kmutnb-1");
    expect(fan).toMatchObject({ expected: true, hasTicket: true });
    expect(fan?.checkins.map((row) => row.ticketId)).toEqual(["f-2", "f-1"]);
    expect(fan?.tickets.every((row) => row.checkin !== null)).toBe(true);
  });

  test("the kiosk may name the event by its slug", async () => {
    const list = await send<{ items: Participant[] }>(
      "reg-staff",
      "GET",
      "/football-r1/participants",
    );
    expect(list.body.items.map((item) => item.userId)).toEqual(["kmitl-1", "kmutt-1"]);
    const { res, body } = await send("reg-staff", "POST", "/football-r1/checkins", {
      userId: "kmitl-1",
      method: "scan",
    });
    expect(res.status).toBe(201);
    const rows = await t.db.select().from(eventCheckin);
    expect(rows).toMatchObject([{ eventId: "e-sport", userId: "kmitl-1", ticketId: "t-kmitl-1" }]);
    const checkinId = body.checkinId as string;
    expect((await send("tech", "DELETE", `/football-r1/checkins/${checkinId}`)).res.status).toBe(
      200,
    );
    expect(await t.db.select().from(eventCheckin)).toEqual([]);
  });

  test("a ticket's QR code checks its holder in", async () => {
    const { res, body } = await send("reg-staff", "POST", "/e-sport/checkins", {
      ticketCode: code("t-kmutt-1"),
      method: "scan",
    });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      code: "checked-in",
      forced: false,
      person: { userId: "kmutt-1" },
    });
  });

  test("an unknown ticket code, or a malformed one, is refused", async () => {
    const unknown = await send("reg-staff", "POST", "/e-sport/checkins", {
      ticketCode: code("nobody"),
      method: "scan",
    });
    expect(unknown.res.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: "unknown" });
    const malformed = await send("reg-staff", "POST", "/e-sport/checkins", {
      ticketCode: "short",
      method: "scan",
    });
    expect(malformed.res.status).toBe(400);
    const both = await send("reg-staff", "POST", "/e-sport/checkins", {
      ticketCode: code("t-kmutt-1"),
      userId: "kmutt-1",
      method: "scan",
    });
    expect(both.res.status).toBe(400);
  });

  test("a ticket to another event is refused, unless its holder has one here too", async () => {
    const scan = () =>
      send("tech", "POST", "/e-general/checkins", {
        ticketCode: code("t-kmitl-1"),
        method: "scan",
      });
    const refused = await scan();
    expect(refused.res.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "wrong-event",
      canForce: true,
      person: { userId: "kmitl-1" },
      otherEvent: { id: "e-sport", name: "ฟุตบอล" },
    });
    await t.db.insert(eventTicket).values(ticket("g-kmitl", "e-general", "kmitl-1", "tt-general"));
    expect((await scan()).res.status).toBe(201);
  });

  test("an expected athlete without a ticket is refused unless a manager forces it", async () => {
    await t.db.delete(eventTicket).where(eq(eventTicket.userId, "kmitl-1"));
    const refused = await checkIn("reg-staff", "kmitl-1");
    expect(refused.res.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "no-ticket", canForce: false });
    expect((await checkIn("reg-staff", "kmitl-1", { force: true })).res.status).toBe(409);
    const forced = await checkIn("tech", "kmitl-1", { force: true });
    expect(forced.res.status).toBe(201);
    expect(forced.body).toMatchObject({ forced: true, ticket: null });
    // Once in without a ticket, they are in.
    expect((await checkIn("tech", "kmitl-1", { force: true })).body).toMatchObject({
      code: "duplicate",
    });
  });

  test("a ticket cancelled between the read and the write is refused", async () => {
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`delete from event_ticket where user_id = 'kmitl-1'`);
    };
    const { res, body } = await checkIn("reg-staff", "kmitl-1");
    expect(res.status).toBe(409);
    expect(body.message).toBe("ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่");
    expect(await t.db.select().from(eventCheckin)).toEqual([]);
  });

  test("other institutions' registration staff cannot run the kiosk", async () => {
    expect((await checkIn("kmutt-head", "kmutt-1")).res.status).toBe(403);
    expect((await checkIn("art", "kmutt-1")).res.status).toBe(403);
  });

  test("anyone holding a ticket checks in, listed or not", async () => {
    await t.db.insert(eventTicket).values(ticket("f-1", "e-sport", "kmutnb-1", "tt-fans"));
    const fan = await checkIn("reg-staff", "kmutnb-1");
    expect(fan.res.status).toBe(201);
    expect(fan.body).toMatchObject({ forced: false, ticket: { typeName: "ผู้ชม" } });
  });

  test("someone without a ticket is shown as off the list when forced in", async () => {
    const refused = await checkIn("tech", "kmutnb-1");
    expect(refused.body).toMatchObject({ code: "no-ticket", canForce: true });
    expect((await checkIn("tech", "kmutnb-1", { force: true })).res.status).toBe(201);
    const { body } = await send<{ items: Participant[] }>("tech", "GET", "/e-sport/participants");
    expect(body.items.find((item) => item.userId === "kmutnb-1")).toMatchObject({
      expected: false,
      hasTicket: false,
      checkin: { forced: true },
    });
  });

  test("an unknown code is reported as such", async () => {
    const { res, body } = await checkIn("reg-staff", "not-a-user");
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ code: "unknown", message: "ไม่พบผู้ใช้จากรหัสนี้" });
  });

  test("a check-in racing another one reports the duplicate", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event_checkin (id, event_id, user_id, ticket_id, method) values ('c-0', 'e-sport', 'kmitl-1', 't-kmitl-1', 'manual')`,
      );
    };
    const { res, body } = await checkIn("reg-staff", "kmitl-1");
    expect(res.status).toBe(409);
    expect(body.code).toBe("duplicate");
  });

  test("only catalog managers undo a check-in, which frees its ticket", async () => {
    const { body } = await checkIn("reg-staff", "kmitl-1");
    const path = `/e-sport/checkins/${body.checkinId as string}`;
    expect((await send("reg-staff", "DELETE", path)).res.status).toBe(403);
    const elsewhere = `/e-general/checkins/${body.checkinId as string}`;
    expect((await send("tech", "DELETE", elsewhere)).res.status).toBe(404);
    expect((await send("tech", "DELETE", path)).res.status).toBe(200);
    expect((await send("tech", "DELETE", path)).res.status).toBe(404);
    expect((await checkIn("reg-staff", "kmitl-1")).res.status).toBe(201);
  });
});
