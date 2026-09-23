import { beforeEach, describe, expect, test } from "bun:test";
import { leadership, user } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, readJson } from "../testing";
import { createDepartmentRoutes } from "./departments";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createDepartmentRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createDepartmentRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("head", { role: "head", department: "Tech/Live" });
});

describe("PATCH /:id/code", () => {
  test("admin sets and clears a code", async () => {
    const art = await t.departmentId("Art");
    const techLive = await t.departmentId("Tech/Live");

    // Free tech-live first so Art can take it (codes are unique).
    let res = await app.request(
      `/${techLive}/code`,
      t.as("admin", { method: "PATCH", json: { code: null } }),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ id: techLive, code: null });

    res = await app.request(
      `/${art}/code`,
      t.as("admin", { method: "PATCH", json: { code: "tech-live" } }),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ id: art, code: "tech-live" });
  });

  test("duplicate code is a 409", async () => {
    const art = await t.departmentId("Art");
    const res = await app.request(
      `/${art}/code`,
      t.as("admin", { method: "PATCH", json: { code: "registration" } }),
    );
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ message: expect.any(String) });
  });

  test("unknown department is a 404", async () => {
    const res = await app.request(
      "/missing/code",
      t.as("admin", { method: "PATCH", json: { code: null } }),
    );
    expect(res.status).toBe(404);
  });

  test("rejects codes outside the known set and unknown keys", async () => {
    const art = await t.departmentId("Art");
    for (const json of [{ code: "art" }, { code: null, extra: 1 }, {}, null]) {
      const res = await app.request(`/${art}/code`, t.as("admin", { method: "PATCH", json }));
      expect(res.status).toBe(400);
    }
  });

  test("non-admins are forbidden, anonymous is unauthorized", async () => {
    const art = await t.departmentId("Art");
    let res = await app.request(
      `/${art}/code`,
      t.as("head", { method: "PATCH", json: { code: null } }),
    );
    expect(res.status).toBe(403);
    res = await app.request(`/${art}/code`, t.as(null, { method: "PATCH", json: { code: null } }));
    expect(res.status).toBe(401);
  });
});

describe("GET /", () => {
  test("lists department codes", async () => {
    const res = await app.request("/", t.as("admin"));
    const body = (await res.json()) as { name: string; code: string | null }[];
    expect(body.find((d) => d.name === "Tech/Live")?.code).toBe("tech-live");
    expect(body.find((d) => d.name === "Art")?.code).toBeNull();
  });
});

describe("DELETE /:id", () => {
  test("refuses to delete a department that still has leaders", async () => {
    const art = await t.departmentId("Art");
    await t.db.insert(leadership).values({ departmentId: art, role: "head", name: "A" });
    await t.seedUser("member", { department: "Art" });
    const res = await app.request(`/${art}`, t.as("admin", { method: "DELETE" }));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ message: expect.any(String) });
    // Nothing changed: the department stays and members keep it.
    const list = await app.request("/", t.as("admin"));
    const body = (await list.json()) as { id: string }[];
    expect(body.some((d) => d.id === art)).toBe(true);
    const [member] = await t.db.select().from(user).where(eq(user.id, "member"));
    expect(member?.departmentId).toBe(art);
  });

  test("still deletes a department without leaders", async () => {
    const art = await t.departmentId("Art");
    const res = await app.request(`/${art}`, t.as("admin", { method: "DELETE" }));
    expect(res.status).toBe(204);
  });
});

describe("cross-site form posts", () => {
  test("a text/plain POST is refused before anything is created", async () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", null]) {
      const headers = new Headers(t.as("admin").headers);
      headers.set("origin", "https://evil.example");
      if (contentType) headers.set("content-type", contentType);
      else headers.delete("content-type");
      const res = await app.request("/", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Evil" }),
      });
      expect(res.status).toBe(415);
    }
    const list = (await (await app.request("/", t.as("admin"))).json()) as { name: string }[];
    expect(list.some((d) => d.name === "Evil")).toBe(false);
  });

  test("JSON posts still work", async () => {
    const res = await app.request("/", t.as("admin", { method: "POST", json: { name: "New" } }));
    expect(res.status).toBe(201);
  });
});
