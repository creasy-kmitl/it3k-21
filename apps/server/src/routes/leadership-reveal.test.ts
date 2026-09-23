import { beforeEach, describe, expect, test } from "bun:test";
import { leadership, leadershipContactReveal, leadershipSocial } from "@it3k/db/schema/index";

import { createTestContext, readJson } from "../testing";
import { type ContactRevealAudit, createLeadershipRoutes, recordContactReveal } from "./leadership";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createLeadershipRoutes>;
let events: ContactRevealAudit[];
let auditFails: boolean;
let seatId: string;

beforeEach(async () => {
  t = createTestContext();
  events = [];
  auditFails = false;
  app = createLeadershipRoutes({
    ...t.deps,
    audit: async (_c, event) => {
      if (auditFails) throw new Error("audit sink down");
      events.push(event);
    },
  });
  await t.seedUser("staff", { department: "Art" });
  await t.seedUser("tech-head", { role: "head", department: "Tech/Live" });
  await t.seedUser("banned", { banned: true });
  const [row] = await t.db
    .insert(leadership)
    .values({
      departmentId: await t.departmentId("Tech/Live"),
      role: "head",
      name: "TH",
      userId: "tech-head",
      phone: "0812345678",
    })
    .returning();
  seatId = row!.id;
  await t.db.insert(leadershipSocial).values([
    { leadershipId: seatId, platform: "line", value: "th.line" },
    { leadershipId: seatId, platform: "instagram", value: "https://instagram.com/th" },
  ]);
});

const reveal = (userId: string | null, json: unknown = { confirmed: true }, id = seatId) =>
  app.request(`/${id}/reveal`, t.as(userId, { method: "POST", json }));

describe("POST /:id/reveal", () => {
  test("returns contact details after recording who asked", async () => {
    const res = await reveal("staff");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await readJson(res)).toEqual({
      phone: "0812345678",
      socials: [
        { platform: "instagram", value: "https://instagram.com/th" },
        { platform: "line", value: "th.line" },
      ],
    });
    expect(events).toEqual([
      {
        actorUserId: "staff",
        actorDepartmentCode: null,
        impersonatedBy: null,
        targetLeadershipId: seatId,
        targetDepartmentId: await t.departmentId("Tech/Live"),
      },
    ]);
  });

  test("records the admin behind an impersonated session", async () => {
    const init = t.as("staff", { method: "POST", json: { confirmed: true } });
    const headers = new Headers(init.headers);
    headers.set("x-test-impersonated-by", "admin-1");
    const res = await app.request(`/${seatId}/reveal`, { ...init, headers });
    expect(res.status).toBe(200);
    expect(events[0]).toMatchObject({ actorUserId: "staff", impersonatedBy: "admin-1" });
  });

  test("rejects non-JSON bodies, so a cross-site form post cannot reveal", async () => {
    const headers = new Headers(t.as("staff").headers);
    headers.set("content-type", "text/plain");
    const res = await app.request(`/${seatId}/reveal`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmed: true }),
    });
    expect(res.status).toBe(415);
    expect(events).toEqual([]);
  });

  test("the audit event carries no contact data or email", async () => {
    await reveal("staff");
    const serialized = JSON.stringify(events);
    for (const secret of ["0812345678", "th.line", "instagram", "@example.com"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("every reveal is audited, including repeats", async () => {
    await reveal("staff");
    await reveal("staff");
    await reveal("tech-head");
    expect(events.map((e) => e.actorUserId)).toEqual(["staff", "staff", "tech-head"]);
    expect(events[2]?.actorDepartmentCode).toBe("tech-live");
  });

  test("stores a durable audit row in D1 before answering", async () => {
    await reveal("staff");
    const rows = await t.db.select().from(leadershipContactReveal);
    expect(rows).toEqual([
      {
        id: expect.any(String),
        actorUserId: "staff",
        actorDepartmentCode: null,
        impersonatedBy: null,
        leadershipId: seatId,
        departmentId: await t.departmentId("Tech/Live"),
        createdAt: expect.any(Date),
      },
    ]);
  });

  test("fails closed when the D1 audit row cannot be written", async () => {
    t.sqlite.run("DROP TABLE leadership_contact_reveal");
    const res = await reveal("staff");
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("0812345678");
    expect(text).not.toContain("th.line");
    expect(JSON.parse(text)).toEqual({ message: expect.any(String) });
    expect(events).toEqual([]);
  });

  test("still answers when only the Axiom mirror fails, since D1 holds the record", async () => {
    auditFails = true;
    const res = await reveal("staff");
    expect(res.status).toBe(200);
    expect(await t.db.select().from(leadershipContactReveal)).toHaveLength(1);
  });

  test("requires explicit confirmation", async () => {
    for (const json of [
      {},
      { confirmed: false },
      { confirmed: "true" },
      { confirmed: true, x: 1 },
      null,
    ]) {
      const res = await reveal("staff", json);
      expect(res.status).toBe(400);
    }
    expect(events).toEqual([]);
  });

  test("anonymous 401, banned 403, unknown 404, malformed id 400 -- none audited", async () => {
    expect((await reveal(null)).status).toBe(401);
    expect((await reveal("banned")).status).toBe(403);
    expect((await reveal("staff", { confirmed: true }, crypto.randomUUID())).status).toBe(404);
    expect((await reveal("staff", { confirmed: true }, "nope")).status).toBe(400);
    expect(events).toEqual([]);
  });

  test("a seat without contact details reveals nulls", async () => {
    const [row] = await t.db
      .insert(leadership)
      .values({ departmentId: await t.departmentId("Art"), role: "head", name: "A" })
      .returning();
    const res = await reveal("staff", { confirmed: true }, row!.id);
    expect(await readJson(res)).toEqual({ phone: null, socials: [] });
  });
});

describe("recordContactReveal", () => {
  const event: ContactRevealAudit = {
    actorUserId: "u1",
    actorDepartmentCode: "tech-live",
    impersonatedBy: "admin-1",
    targetLeadershipId: "seat-1",
    targetDepartmentId: "dept-1",
  };

  test("writes a force-kept evlog audit on the request's wide event", () => {
    const calls: unknown[] = [];
    const audit = Object.assign((input: unknown) => void calls.push(["audit", input]), {
      deny: () => {},
    });
    const set = (context: unknown) => void calls.push(["set", context]);
    recordContactReveal({ audit, set }, event);
    expect(calls).toEqual([
      ["set", { leadership: { actorDepartmentCode: "tech-live", impersonatedBy: "admin-1" } }],
      [
        "audit",
        {
          action: "leadership.contact.revealed",
          actor: { type: "user", id: "u1" },
          target: { type: "leadership", id: "seat-1", departmentId: "dept-1" },
          outcome: "success",
        },
      ],
    ]);
  });

  test("throws when the request logger is missing so the route fails closed", () => {
    expect(() => recordContactReveal(undefined, event)).toThrow();
  });
});
