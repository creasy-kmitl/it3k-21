import { beforeEach, describe, expect, test } from "bun:test";
import { user } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { createTestContext, readJson } from "../../testing";
import { createUserRoutes } from "../users";
import { createViewAsRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: Hono;

beforeEach(async () => {
  t = createTestContext();
  app = new Hono()
    .route("/api/view-as", createViewAsRoutes(t.deps))
    .route("/api/users", createUserRoutes(t.deps));
  await t.seedUser("admin", { role: "admin", department: "Art" });
  await t.seedUser("admin-2", { role: "admin" });
  await t.seedUser("art-staff", { department: "Art" });
  await t.seedUser("tech", { department: "Tech/Live" });
});

/** The `name=value` pair of the view-as cookie a response sets. */
function viewCookie(res: Response) {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("__Host-it3k_view_as="));
  if (!header) throw new Error("no view-as cookie set");
  return header.split(";")[0] ?? "";
}

async function startView(json: unknown, as = "admin") {
  const res = await app.request("/api/view-as", t.as(as, { method: "POST", json }));
  return res;
}

async function viewAsTechStaff() {
  const res = await startView({
    kind: "staff",
    departmentId: await t.departmentId("Tech/Live"),
    institution: "kmitl",
  });
  expect(res.status).toBe(200);
  return viewCookie(res);
}

async function me(userId: string, cookie?: string) {
  return app.request("/api/users/me", t.as(userId, { cookie }));
}

describe("starting a view", () => {
  test("sets a signed, host-only cookie and describes the view", async () => {
    const res = await startView({
      kind: "head",
      departmentId: await t.departmentId("Tech/Live"),
      institution: null,
    });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      active: true,
      kind: "head",
      department: { name: "Tech/Live" },
      institution: null,
    });
    const header = res.headers.getSetCookie().find((c) => c.startsWith("__Host-it3k_view_as="));
    expect(header).toBeDefined();
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=None");
    expect(header).not.toContain("Domain=");
  });

  test("is for admins only", async () => {
    const res = await startView({ kind: "guest", institution: null }, "art-staff");
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("is refused to an impersonated session, even one an admin started", async () => {
    const res = await app.request(
      "/api/view-as",
      t.as("art-staff", {
        method: "POST",
        json: { kind: "guest", institution: null },
        impersonatedBy: "admin",
      }),
    );
    expect(res.status).toBe(403);
  });

  test("staff and seats need a department that exists", async () => {
    expect((await startView({ kind: "staff", institution: null })).status).toBe(400);
    const res = await startView({ kind: "staff", departmentId: "nope", institution: null });
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("refuses unknown kinds, such as admin", async () => {
    expect((await startView({ kind: "admin", institution: null })).status).toBe(400);
  });
});

describe("while viewing", () => {
  test("the API sees the chosen role, department and institution", async () => {
    const cookie = await viewAsTechStaff();
    const res = await me("admin", cookie);
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      id: "admin",
      role: "staff",
      department: { name: "Tech/Live" },
      seatRole: null,
      institution: "kmitl",
      // Tech/Live manages accounts.
      canManageUsers: true,
      viewingAs: true,
    });
  });

  test("a seat comes through as staff holding that seat", async () => {
    const res = await startView({
      kind: "vicehead",
      departmentId: await t.departmentId("Art"),
      institution: null,
    });
    const body = await readJson(await me("admin", viewCookie(res)));
    expect(body).toMatchObject({
      role: "staff",
      seatRole: "vicehead",
      department: { name: "Art" },
    });
  });

  test("a guest is kept out of member routes", async () => {
    const res = await startView({ kind: "guest", institution: null });
    expect((await me("admin", viewCookie(res))).status).toBe(403);
  });

  test("every write is refused and nothing changes", async () => {
    const cookie = await viewAsTechStaff();
    const res = await app.request(
      "/api/users/art-staff/assignment",
      t.as("admin", { method: "PUT", json: { kind: "guest" }, cookie }),
    );
    expect(res.status).toBe(403);
    expect((await readJson(res)).message).toContain("ดูได้อย่างเดียว");
    const [row] = await t.db.select().from(user).where(eq(user.id, "art-staff"));
    expect(row?.role).toBe("staff");
  });

  test("the view routes still see the admin, so the view can be read and ended", async () => {
    const cookie = await viewAsTechStaff();
    const read = await app.request("/api/view-as", t.as("admin", { cookie }));
    expect(await readJson(read)).toMatchObject({
      active: true,
      kind: "staff",
      institution: "kmitl",
    });
    const end = await app.request("/api/view-as", t.as("admin", { method: "DELETE", cookie }));
    expect(end.status).toBe(200);
    const cleared = end.headers.getSetCookie().find((c) => c.startsWith("__Host-it3k_view_as="));
    expect(cleared).toContain("Max-Age=0");
  });
});

describe("the cookie grants nothing on its own", () => {
  test("another account sending it is unaffected", async () => {
    const cookie = await viewAsTechStaff();
    const body = await readJson(await me("art-staff", cookie));
    expect(body).toMatchObject({ role: "staff", department: { name: "Art" }, viewingAs: false });
  });

  test("another admin sending it is unaffected", async () => {
    const cookie = await viewAsTechStaff();
    const body = await readJson(await me("admin-2", cookie));
    expect(body).toMatchObject({ role: "admin", viewingAs: false });
  });

  test("an admin who lost the role is unaffected", async () => {
    const cookie = await viewAsTechStaff();
    await t.db.update(user).set({ role: "staff" }).where(eq(user.id, "admin"));
    const body = await readJson(await me("admin", cookie));
    expect(body).toMatchObject({ role: "staff", department: { name: "Art" }, viewingAs: false });
  });

  test("a tampered value is ignored", async () => {
    const cookie = await viewAsTechStaff();
    const [name, value = ""] = cookie.split("=");
    const decoded = decodeURIComponent(value);
    const forged = decoded.replace('"kind":"staff"', '"kind":"athlete"');
    expect(forged).not.toBe(decoded);
    const body = await readJson(await me("admin", `${name}=${encodeURIComponent(forged)}`));
    expect(body).toMatchObject({ role: "admin", viewingAs: false });
  });

  test("the same value without the __Host- prefix is ignored", async () => {
    const cookie = await viewAsTechStaff();
    const body = await readJson(await me("admin", cookie.replace("__Host-", "")));
    expect(body).toMatchObject({ role: "admin", viewingAs: false });
  });

  test("an impersonated session ignores the admin's view", async () => {
    const cookie = await viewAsTechStaff();
    const res = await app.request(
      "/api/users/me",
      t.as("tech", { cookie, impersonatedBy: "admin" }),
    );
    expect(await readJson(res)).toMatchObject({ id: "tech", viewingAs: false });
  });
});

describe("impersonation", () => {
  test("acts as the target while the admin behind it is still one", async () => {
    const res = await app.request("/api/users/me", t.as("tech", { impersonatedBy: "admin" }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ id: "tech", department: { name: "Tech/Live" } });
  });

  test("allows writes, as the target", async () => {
    // Tech/Live staff without a seat may make a non-member a guest.
    await t.seedUser("runner", { role: "participant" });
    const res = await app.request(
      "/api/users/runner/assignment",
      t.as("tech", { method: "PUT", json: { kind: "guest" }, impersonatedBy: "admin" }),
    );
    expect(res.status).toBe(200);
  });

  test("ends an hour after it began, whatever expiry the session has", async () => {
    const res = await app.request(
      "/api/users/me",
      t.as("tech", {
        impersonatedBy: "admin",
        sessionCreatedAt: new Date(Date.now() - 60 * 60 * 1000 - 1),
      }),
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)).message).toContain("หมดเวลาสวมบัญชี");
  });

  test("ends once the admin behind it is demoted, banned or gone", async () => {
    const asTech = () => app.request("/api/users/me", t.as("tech", { impersonatedBy: "admin" }));
    await t.db.update(user).set({ banned: true }).where(eq(user.id, "admin"));
    expect((await asTech()).status).toBe(401);
    await t.db.update(user).set({ banned: false, role: "staff" }).where(eq(user.id, "admin"));
    expect((await asTech()).status).toBe(401);
    const ghost = await app.request("/api/users/me", t.as("tech", { impersonatedBy: "nobody" }));
    expect(ghost.status).toBe(401);
  });
});

describe("canImpersonate", () => {
  async function flags(as: string, cookie?: string) {
    const res = await app.request("/api/users", t.as(as, { cookie }));
    const body = (await res.json()) as { items: { id: string; canImpersonate: boolean }[] };
    return Object.fromEntries(body.items.map((item) => [item.id, item.canImpersonate]));
  }

  test("an admin may act as non-admins, never as themselves or another admin", async () => {
    expect(await flags("admin")).toEqual({
      admin: false,
      "admin-2": false,
      "art-staff": true,
      tech: true,
    });
  });

  test("account managers who are not admins may not", async () => {
    expect(Object.values(await flags("tech")).some(Boolean)).toBe(false);
  });

  test("an admin viewing as someone else may not", async () => {
    const cookie = await viewAsTechStaff();
    expect(Object.values(await flags("admin", cookie)).some(Boolean)).toBe(false);
  });
});
