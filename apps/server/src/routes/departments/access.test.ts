import { beforeEach, describe, expect, test } from "bun:test";
import { department } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext } from "../../testing";
import { createDepartmentRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createDepartmentRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createDepartmentRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("reg-head", { department: "ทะเบียน", seat: "head", institution: "kmitl" });
  await t.seedUser("reg-vice", { department: "ทะเบียน", seat: "vicehead", institution: "kmitl" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("tech-head", { department: "Tech/Live", seat: "head", institution: "kmitl" });
  await t.seedUser("art-head", { department: "Art", seat: "head", institution: "kmitl" });
});

const create = (who: string, name: string) =>
  app.request("/", t.as(who, { method: "POST", json: { name } }));

describe("departments", () => {
  test("admins and KMITL's ทะเบียน heads and viceheads create, edit and delete them", async () => {
    for (const who of ["admin", "reg-head", "reg-vice"]) {
      expect((await app.request("/", t.as(who))).status).toBe(200);
      const res = await create(who, `New ${who}`);
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const patch = await app.request(
        `/${id}`,
        t.as(who, { method: "PATCH", json: { name: `Renamed ${who}` } }),
      );
      expect(patch.status).toBe(200);
      expect((await app.request(`/${id}`, t.as(who, { method: "DELETE" }))).status).toBe(204);
    }
  });

  test("ทะเบียน staff, other institutions' leaders and other departments' leaders cannot", async () => {
    // A seat held from before seats were KMITL's only.
    t.sqlite.run("update user set institution = 'kmutt' where id = 'reg-vice'");
    for (const who of ["reg-staff", "reg-vice", "tech-head", "art-head"]) {
      expect((await app.request("/", t.as(who))).status).toBe(403);
      expect((await create(who, `New ${who}`)).status).toBe(403);
    }
    expect(
      await t.db.select().from(department).where(eq(department.name, "New reg-staff")),
    ).toEqual([]);
  });

  test("a leader who loses their seat meanwhile writes nothing", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("delete from leadership where user_id = 'reg-head'");
    };
    expect((await create("reg-head", "Raced")).status).toBe(409);
    expect(await t.db.select().from(department).where(eq(department.name, "Raced"))).toEqual([]);
  });
});
