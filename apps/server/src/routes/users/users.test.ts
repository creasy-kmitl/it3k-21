import { beforeEach, describe, expect, test } from "bun:test";
import { leadership, leadershipSocial, user } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createLeadershipRoutes } from "../leadership";
import { createUserRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createUserRoutes>;

type Account = {
  id: string;
  name: string;
  role: "guest" | "athlete" | "staff" | "admin";
  department: { id: string; name: string } | null;
  seatRole: "head" | "vicehead" | null;
  canEdit: boolean;
};

beforeEach(async () => {
  t = createTestContext();
  app = createUserRoutes(t.deps);
  await t.seedUser("admin", { role: "admin", name: "Admin" });
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("reg-vice", { seat: "vicehead", department: "ทะเบียน", name: "Reg Vice" });
  await t.seedUser("art-staff", { department: "Art", name: "Art Staff" });
  await t.seedUser("guest", { role: "guest", name: "New Guest" });
});

async function send<T = unknown>(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

const assign = (who: string, id: string, json: unknown) =>
  send<Account>(who, "PUT", `/${id}/assignment`, json);

async function stored(id: string) {
  const [row] = await t.db.select().from(user).where(eq(user.id, id));
  return row;
}

async function seatOf(id: string) {
  const [row] = await t.db.select().from(leadership).where(eq(leadership.userId, id));
  return row;
}

describe("access", () => {
  test("admins and every Tech/Live or ทะเบียน member manage users", async () => {
    for (const who of ["admin", "tech-staff", "reg-vice"]) {
      expect((await send(who, "GET", "/")).res.status).toBe(200);
    }
    expect((await send("art-staff", "GET", "/")).res.status).toBe(403);
  });

  test("guests are refused everywhere, leadership included", async () => {
    for (const path of ["/", "/me"]) {
      expect((await send("guest", "GET", path)).res.status).toBe(403);
    }
    const leadershipApp = createLeadershipRoutes({ ...t.deps, audit: async () => {} });
    const res = await leadershipApp.request("/", t.as("guest"));
    expect(res.status).toBe(403);
  });

  test("/me reports the caller's department, seat and rights", async () => {
    const { body } = await send<Record<string, unknown>>("reg-vice", "GET", "/me");
    expect(body).toMatchObject({
      role: "staff",
      seatRole: "vicehead",
      department: { name: "ทะเบียน" },
      canManageUsers: true,
    });
    expect((await send("art-staff", "GET", "/me")).body).toMatchObject({ canManageUsers: false });
  });

  test("never exposes emails", async () => {
    const { body } = await send("admin", "GET", "/");
    expect(JSON.stringify(body)).not.toContain("@");
  });
});

describe("PUT /:id/assignment", () => {
  test("makes a guest staff of a department", async () => {
    const art = await t.departmentId("Art");
    const { res, body } = await assign("tech-staff", "guest", { kind: "staff", departmentId: art });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ role: "staff", department: { id: art }, seatRole: null });
  });

  test("makes someone an athlete, leaving their department and seat", async () => {
    const seat = defined(await seatOf("reg-vice"), "reg-vice's seat");
    const { res, body } = await assign("admin", "reg-vice", { kind: "athlete" });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ role: "athlete", department: null, seatRole: null });
    expect(await t.db.select().from(leadership).where(eq(leadership.id, seat.id))).toEqual([]);
    // Athletes, like guests, are kept out of the signed-in app.
    expect((await send("reg-vice", "GET", "/me")).res.status).toBe(403);
  });

  test("makes someone head of a vacant seat", async () => {
    const pr = await t.departmentId("PR");
    const { body } = await assign("admin", "art-staff", { kind: "head", departmentId: pr });
    expect(body).toMatchObject({ role: "staff", department: { id: pr }, seatRole: "head" });
    expect(await seatOf("art-staff")).toMatchObject({ departmentId: pr, name: "Art Staff" });
  });

  test("taking an occupied seat replaces its holder and clears their contact", async () => {
    const reg = await t.departmentId("ทะเบียน");
    const seat = defined(await seatOf("reg-vice"), "reg-vice's seat");
    await t.db.update(leadership).set({ phone: "0812345678" }).where(eq(leadership.id, seat.id));
    await t.db
      .insert(leadershipSocial)
      .values({ leadershipId: seat.id, platform: "line", value: "x" });

    const { body } = await assign("admin", "art-staff", { kind: "vicehead", departmentId: reg });
    expect(body).toMatchObject({ seatRole: "vicehead", department: { id: reg } });
    const [now] = await t.db.select().from(leadership).where(eq(leadership.id, seat.id));
    expect(now).toMatchObject({ userId: "art-staff", name: "Art Staff", phone: null });
    expect(
      await t.db.select().from(leadershipSocial).where(eq(leadershipSocial.leadershipId, seat.id)),
    ).toEqual([]);
    // The previous holder stays on as staff of the department.
    expect(await seatOf("reg-vice")).toBeUndefined();
    expect(await stored("reg-vice")).toMatchObject({ departmentId: reg, role: "staff" });
  });

  test("leaving a seat deletes it", async () => {
    const seat = defined(await seatOf("reg-vice"), "reg-vice's seat");
    const art = await t.departmentId("Art");
    await assign("admin", "reg-vice", { kind: "staff", departmentId: art });
    expect(await t.db.select().from(leadership).where(eq(leadership.id, seat.id))).toEqual([]);

    await assign("admin", "tech-staff", { kind: "head", departmentId: art });
    const { body } = await assign("admin", "tech-staff", { kind: "guest" });
    expect(body).toMatchObject({ role: "guest", department: null, seatRole: null });
    expect(await seatOf("tech-staff")).toBeUndefined();
  });

  test("re-assigning the same seat keeps it and its contact", async () => {
    const reg = await t.departmentId("ทะเบียน");
    const seat = defined(await seatOf("reg-vice"), "reg-vice's seat");
    await t.db.update(leadership).set({ phone: "0812345678" }).where(eq(leadership.id, seat.id));
    await assign("admin", "reg-vice", { kind: "vicehead", departmentId: reg });
    expect(await seatOf("reg-vice")).toMatchObject({ id: seat.id, phone: "0812345678" });
  });

  test("admins stay admins; only admins may change them", async () => {
    const art = await t.departmentId("Art");
    await t.seedUser("admin-2", { role: "admin" });
    const denied = await assign("tech-staff", "admin-2", { kind: "staff", departmentId: art });
    expect(denied.res.status).toBe(403);
    const { body } = await assign("admin", "admin-2", { kind: "head", departmentId: art });
    expect(body).toMatchObject({ role: "admin", seatRole: "head" });
  });

  test("non-managers cannot assign; unknown targets are 404", async () => {
    expect((await assign("art-staff", "guest", { kind: "guest" })).res.status).toBe(403);
    expect((await assign("admin", "nobody", { kind: "guest" })).res.status).toBe(404);
    const missing = await assign("admin", "guest", { kind: "staff", departmentId: "missing" });
    expect(missing.res.status).toBe(404);
    const bad = await assign("admin", "guest", { kind: "staff" });
    expect(bad.res.status).toBe(400);
    expect((await stored("guest"))?.role).toBe("guest");
  });
});

describe("PUT /:id/admin", () => {
  test("only admins grant or remove admin", async () => {
    let { res } = await send("tech-staff", "PUT", "/guest/admin", { admin: true });
    expect(res.status).toBe(403);
    let body: unknown;
    ({ res, body } = await send("admin", "PUT", "/guest/admin", { admin: true }));
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ role: "admin" });
    // Without a department they fall back to guest.
    ({ body } = await send("admin", "PUT", "/guest/admin", { admin: false }));
    expect(body).toMatchObject({ role: "guest" });
  });

  test("admins cannot remove their own admin role", async () => {
    const { res } = await send("admin", "PUT", "/admin/admin", { admin: false });
    expect(res.status).toBe(400);
    expect((await stored("admin"))?.role).toBe("admin");
  });
});
