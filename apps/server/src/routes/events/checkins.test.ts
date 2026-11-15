import { beforeEach, describe, expect, test } from "bun:test";
import {
  athlete,
  event,
  eventCheckin,
  eventDivision,
  eventInstitution,
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
  divisions: { name: string }[];
  checkin: { method: string; forced: boolean } | null;
};

beforeEach(async () => {
  t = createTestContext();
  app = createEventRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live" });
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
    { id: "e-sport", type: "sport", name: "ฟุตบอล", startAt: START, endAt: END },
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

  test("a general event lists whoever checked in", async () => {
    const general = (userId: string) =>
      send("reg-staff", "POST", "/e-general/checkins", { userId, method: "manual" });
    expect((await general("kmutnb-1")).res.status).toBe(201);
    const { body } = await send<{ items: Participant[] }>("tech", "GET", "/e-general/participants");
    expect(body.items).toMatchObject([
      { userId: "kmutnb-1", expected: true, checkin: { method: "manual", forced: false } },
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
