import { beforeEach, describe, expect, test } from "bun:test";
import { RESERVED_DEPARTMENT_CODES, department, leadership, user } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { createDepartmentRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createDepartmentRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createDepartmentRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("head", { seat: "head", department: "Tech/Live" });
});

describe("department codes are locked", () => {
  test("PATCH /:id/code no longer exists", async () => {
    const art = await t.departmentId("Art");
    const res = await app.request(
      `/${art}/code`,
      t.as("admin", { method: "PATCH", json: { code: "tech-live" } }),
    );
    expect(res.status).toBe(404);
  });

  test("a department with a code cannot be deleted through the API", async () => {
    const reg = await t.departmentId("ทะเบียน");
    await t.seedUser("clerk", { department: "ทะเบียน" });
    const res = await app.request(`/${reg}`, t.as("admin", { method: "DELETE" }));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({
      message: "A department with a code cannot be deleted",
    });
    const [kept] = await t.db.select().from(department).where(eq(department.id, reg));
    expect(kept?.code).toBe("registration");
    const [clerk] = await t.db.select().from(user).where(eq(user.id, "clerk"));
    expect(clerk?.departmentId).toBe(reg);
  });

  test("a coded department can still be renamed and restyled", async () => {
    const tech = await t.departmentId("Tech/Live");
    const res = await app.request(
      `/${tech}`,
      t.as("admin", { method: "PATCH", json: { name: "Tech", icon: "radio", color: "sky" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Tech", code: "tech-live", icon: "radio" });
  });

  const raw: [string, string][] = [
    ["clearing a code", "update department set code = null where code = 'tech-live'"],
    ["moving a code", "update department set code = 'registration' where name = 'Art'"],
    ["setting a code", "update department set code = 'tech-live' where name = 'Art'"],
    ["swapping codes", "update department set code = 'other' where code = 'registration'"],
    ["deleting a coded department", "delete from department where code = 'art'"],
  ];
  for (const [what, statement] of raw) {
    test(`raw SQL ${what} is refused by the database`, () => {
      expect(() => t.sqlite.run(statement)).toThrow(/department_code_protected/);
    });
  }

  test("raw SQL may still rename a coded department or delete one without a code", () => {
    t.sqlite.run("insert into department (id, name) values ('plain', 'Plain')");
    t.sqlite.run("update department set name = 'Live' where code = 'tech-live'");
    t.sqlite.run("delete from department where name = 'Plain'");
    const names = t.sqlite
      .query<{ name: string }, []>("select name from department")
      .all()
      .map((row) => row.name);
    expect(names).toContain("Live");
    expect(names).not.toContain("Plain");
  });

  test("every reserved code belongs to exactly one department", async () => {
    const rows = await t.db.select({ code: department.code }).from(department);
    for (const reserved of RESERVED_DEPARTMENT_CODES) {
      expect(rows.filter((row) => row.code === reserved)).toHaveLength(1);
    }
  });
});

describe("GET /", () => {
  test("lists department codes", async () => {
    const res = await app.request("/", t.as("admin"));
    const body = (await res.json()) as { name: string; code: string | null }[];
    expect(body.find((d) => d.name === "Tech/Live")?.code).toBe("tech-live");
    expect(body.find((d) => d.name === "Art")?.code).toBe("art");
  });
});

describe("POST / with a code", () => {
  const create = (json: unknown) => app.request("/", t.as("admin", { method: "POST", json }));

  test("creates a department with its code", async () => {
    const res = await create({ name: "Security", code: "security-team" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Security", code: "security-team" });
  });

  test("the code is optional; an empty one is stored as null", async () => {
    for (const [name, code] of [
      ["No code", undefined],
      ["Empty code", ""],
      ["Null", null],
    ]) {
      const res = await create({ name, code });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ name, code: null });
    }
  });

  test("refuses badly formed codes", async () => {
    for (const code of ["Art", "has space", "-lead", "trail-", "a--b", "x".repeat(33), "ฝ่าย"]) {
      expect((await create({ name: `Bad ${code}`, code })).status).toBe(400);
    }
  });

  test("refuses reserved codes, which only a migration may assign", async () => {
    for (const code of RESERVED_DEPARTMENT_CODES) {
      expect((await create({ name: `Fake ${code}`, code })).status).toBe(400);
    }
  });

  test("a code already in use is a 409 naming the code", async () => {
    const res = await create({ name: "Art 2", code: "art" });
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ message: "Another department already has this code" });
  });

  test("PATCH cannot set or change a code", async () => {
    const created = (await (await create({ name: "Uncoded" })).json()) as { id: string };
    const art = await t.departmentId("Art");
    for (const id of [created.id, art]) {
      const res = await app.request(
        `/${id}`,
        t.as("admin", { method: "PATCH", json: { code: "renamed-code" } }),
      );
      expect(res.status).toBe(200);
    }
    const rows = await t.db.select({ code: department.code }).from(department);
    expect(rows.some((row) => row.code === "renamed-code")).toBe(false);
  });

  test("a department created with a code cannot be deleted", async () => {
    const created = (await (await create({ name: "Kept", code: "kept" })).json()) as {
      id: string;
    };
    const res = await app.request(`/${created.id}`, t.as("admin", { method: "DELETE" }));
    expect(res.status).toBe(409);
  });
});

describe("DELETE /:id", () => {
  test("refuses to delete a department that still has leaders", async () => {
    // Departments with a code are never deletable, so test one created without.
    await t.db.insert(department).values({ name: "Plain" });
    const art = await t.departmentId("Plain");
    await t.db.insert(leadership).values({ departmentId: art, role: "head", name: "A" });
    await t.seedUser("member", { department: "Plain" });
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

  test("still deletes a department without leaders or a code", async () => {
    await t.db.insert(department).values({ name: "Plain" });
    const art = await t.departmentId("Plain");
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

describe("department membership vs. seats", () => {
  beforeEach(async () => {
    await t.seedUser("art-lead", { department: "Art" });
    await t.db.insert(leadership).values({
      departmentId: await t.departmentId("Art"),
      role: "head",
      name: "A",
      userId: "art-lead",
    });
  });

  const departmentOf = async (id: string) =>
    (await t.db.select().from(user).where(eq(user.id, id)))[0]?.departmentId;

  test("an account holding a seat cannot be moved to another department", async () => {
    const pr = await t.departmentId("PR");
    const res = await app.request(`/${pr}/members/art-lead`, t.as("admin", { method: "PUT" }));
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ message: expect.any(String) });
    expect(await departmentOf("art-lead")).toBe(await t.departmentId("Art"));
  });

  test("or removed from its department", async () => {
    const art = await t.departmentId("Art");
    const res = await app.request(`/${art}/members/art-lead`, t.as("admin", { method: "DELETE" }));
    expect(res.status).toBe(409);
    expect(await departmentOf("art-lead")).toBe(art);
  });

  test("re-assigning to the seat's own department is fine", async () => {
    const art = await t.departmentId("Art");
    const res = await app.request(`/${art}/members/art-lead`, t.as("admin", { method: "PUT" }));
    expect(res.status).toBe(200);
  });

  test("after detaching the seat the move goes through", async () => {
    await t.db.update(leadership).set({ userId: null }).where(eq(leadership.userId, "art-lead"));
    const pr = await t.departmentId("PR");
    const res = await app.request(`/${pr}/members/art-lead`, t.as("admin", { method: "PUT" }));
    expect(res.status).toBe(200);
    expect(await departmentOf("art-lead")).toBe(pr);
  });
});

describe("department icon and color", () => {
  test("seeded departments start with their own icon and color", async () => {
    const res = await app.request("/", t.as("admin"));
    const body = (await res.json()) as { name: string; icon: string; color: string }[];
    expect(body.find((d) => d.name === "Art")).toMatchObject({ icon: "palette", color: "rose" });
    expect(new Set(body.map((d) => d.color)).size).toBe(body.length);
  });

  test("admin changes them; unknown values are rejected", async () => {
    const art = await t.departmentId("Art");
    let res = await app.request(
      `/${art}`,
      t.as("admin", { method: "PATCH", json: { icon: "camera", color: "sky" } }),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({ name: "Art", icon: "camera", color: "sky" });

    res = await app.request(
      `/${art}`,
      t.as("admin", { method: "PATCH", json: { icon: "skull", color: "chartreuse" } }),
    );
    expect(res.status).toBe(400);
  });

  test("unset departments use the built-in look; a renamed one falls back to generic", async () => {
    const art = await t.departmentId("Art");
    const [stored] = await t.db
      .select({ icon: department.icon, color: department.color })
      .from(department)
      .where(eq(department.id, art));
    expect(stored).toEqual({ icon: null, color: null });

    const res = await app.request(
      `/${art}`,
      t.as("admin", { method: "PATCH", json: { name: "Art & Design" } }),
    );
    expect(await readJson(res)).toMatchObject({ icon: "folder", color: "slate" });
  });

  test("new departments default to a folder in slate", async () => {
    const res = await app.request("/", t.as("admin", { method: "POST", json: { name: "New" } }));
    expect(res.status).toBe(201);
    expect(await readJson(res)).toMatchObject({ icon: "folder", color: "slate" });
  });
});
