import { beforeEach, describe, expect, test } from "bun:test";
import {
  athlete,
  event,
  eventCheckin,
  eventDivision,
  eventInstitution,
  eventTicket,
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
  // The expected athletes have claimed their tickets.
  await t.db.insert(eventTicket).values([
    { id: "t-kmitl-1", eventId: "e-sport", userId: "kmitl-1", code: code("kmitl-1") },
    { id: "t-kmutt-1", eventId: "e-sport", userId: "kmutt-1", code: code("kmutt-1") },
  ]);
});

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
      .values({ eventId: "e-general", userId: "kmutnb-1", code: code("general-kmutnb") });
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
  test("kiosk operators check in expected athletes once", async () => {
    const first = await checkIn("reg-staff", "kmitl-1");
    expect(first.res.status).toBe(201);
    expect(first.body).toMatchObject({
      code: "checked-in",
      forced: false,
      person: { userId: "kmitl-1", institution: "kmitl", divisions: [{ name: "ฟุตบอล" }] },
    });
    const again = await checkIn("tech", "kmitl-1");
    expect(again.res.status).toBe(409);
    expect(again.body).toMatchObject({ code: "duplicate", person: { userId: "kmitl-1" } });
    expect(typeof again.body.checkedInAt).toBe("string");
  });

  test("the kiosk may name the event by its slug", async () => {
    const list = await send<{ items: Participant[] }>(
      "reg-staff",
      "GET",
      "/football-r1/participants",
    );
    expect(list.body.items.map((item) => item.userId)).toEqual(["kmitl-1", "kmutt-1"]);
    const { res } = await send("reg-staff", "POST", "/football-r1/checkins", {
      userId: "kmitl-1",
      method: "scan",
    });
    expect(res.status).toBe(201);
    const rows = await t.db.select().from(eventCheckin);
    expect(rows).toMatchObject([{ eventId: "e-sport", userId: "kmitl-1" }]);
    expect((await send("tech", "DELETE", "/football-r1/checkins/kmitl-1")).res.status).toBe(200);
    expect(await t.db.select().from(eventCheckin)).toEqual([]);
  });

  test("a ticket's QR code checks its holder in", async () => {
    const { res, body } = await send("reg-staff", "POST", "/e-sport/checkins", {
      ticketCode: code("kmutt-1"),
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
      ticketCode: code("kmutt-1"),
      userId: "kmutt-1",
      method: "scan",
    });
    expect(both.res.status).toBe(400);
  });

  test("a ticket to another event is refused, unless its holder has one here too", async () => {
    const scan = () =>
      send("tech", "POST", "/e-general/checkins", { ticketCode: code("kmitl-1"), method: "scan" });
    const refused = await scan();
    expect(refused.res.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "wrong-event",
      canForce: true,
      person: { userId: "kmitl-1" },
      otherEvent: { id: "e-sport", name: "ฟุตบอล" },
    });
    await t.db
      .insert(eventTicket)
      .values({ eventId: "e-general", userId: "kmitl-1", code: code("general-kmitl") });
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
    expect(forced.body).toMatchObject({ forced: true });
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

  test("someone not on the list is refused unless a manager forces it", async () => {
    const refused = await checkIn("reg-staff", "kmutnb-1");
    expect(refused.res.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "not-listed", canForce: false });
    // Staff cannot force even when asking to.
    expect((await checkIn("reg-staff", "kmutnb-1", { force: true })).res.status).toBe(409);

    const managerRefused = await checkIn("tech", "kmutnb-1");
    expect(managerRefused.body).toMatchObject({ code: "not-listed", canForce: true });
    const forced = await checkIn("tech", "kmutnb-1", { force: true });
    expect(forced.res.status).toBe(201);
    expect(forced.body).toMatchObject({ forced: true });

    const { body } = await send<{ items: Participant[] }>("tech", "GET", "/e-sport/participants");
    expect(body.items.find((item) => item.userId === "kmutnb-1")).toMatchObject({
      expected: false,
      checkin: { forced: true },
    });
  });

  test("an unknown code is reported as such", async () => {
    const { res, body } = await checkIn("reg-staff", "not-a-user");
    expect(res.status).toBe(404);
    expect(body).toMatchObject({ code: "unknown", message: "ไม่พบผู้ใช้จากรหัสนี้" });
  });

  test("a registration rejected between the read and the write is refused", async () => {
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`update sport_registration set status = 'rejected' where user_id = 'kmitl-1'`);
    };
    expect((await checkIn("reg-staff", "kmitl-1")).res.status).toBe(409);
    const rows = await t.db.select().from(eventCheckin);
    expect(rows).toEqual([]);
  });

  test("a check-in racing another one reports the duplicate", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        `insert into event_checkin (id, event_id, user_id, method) values ('c-0', 'e-sport', 'kmitl-1', 'manual')`,
      );
    };
    const { res, body } = await checkIn("reg-staff", "kmitl-1");
    expect(res.status).toBe(409);
    expect(body.code).toBe("duplicate");
  });

  test("only catalog managers undo a check-in", async () => {
    await checkIn("reg-staff", "kmitl-1");
    expect((await send("reg-staff", "DELETE", "/e-sport/checkins/kmitl-1")).res.status).toBe(403);
    expect((await send("tech", "DELETE", "/e-sport/checkins/kmitl-1")).res.status).toBe(200);
    expect((await send("tech", "DELETE", "/e-sport/checkins/kmitl-1")).res.status).toBe(404);
    expect((await checkIn("reg-staff", "kmitl-1")).res.status).toBe(201);
  });
});
