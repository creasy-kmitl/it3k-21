import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { department, user } from "@it3k/db/schema/index";
import { createTestContext, defined } from "../../testing";
import { createDepartmentRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
beforeEach(async () => {
  t = createTestContext();
  await t.seedUser("admin", { role: "admin", department: "Art" });
  await t.seedUser("member", { department: "Art" });
});
for (const operation of ["create", "edit", "delete", "code", "assign", "remove"] as const) {
  for (const revocation of ["role", "ban", "removal"] as const) {
    test(`${operation} rolls back after actor ${revocation} revocation`, async () => {
      const app = createDepartmentRoutes(t.deps);
      const art = await t.departmentId("Art");
      const tech = await t.departmentId("Tech/Live");
      const original = defined(
        (await t.db.select().from(department).where(eq(department.id, art)))[0],
      );
      t.hooks.beforeBatch = () => {
        t.hooks.beforeBatch = undefined;
        if (revocation === "role")
          t.sqlite.run("update user set role = 'staff' where id = 'admin'");
        if (revocation === "ban") t.sqlite.run("update user set banned = 1 where id = 'admin'");
        if (revocation === "removal") t.sqlite.run("delete from user where id = 'admin'");
      };
      const [path, method, json] = {
        create: ["/", "POST", { name: "Unauthorized new department" }],
        edit: [`/${art}`, "PATCH", { name: "Unauthorized rename" }],
        delete: [`/${art}`, "DELETE", undefined],
        code: [`/${art}/code`, "PATCH", { code: null }],
        assign: [`/${tech}/members/admin`, "PUT", undefined],
        remove: [`/${art}/members/member`, "DELETE", undefined],
      }[operation] as [string, string, unknown];
      const res = await app.request(path, t.as("admin", { method, json }));
      expect(res.status).toBe(409);
      expect(
        defined((await t.db.select().from(department).where(eq(department.id, art)))[0]),
      ).toEqual(original);
      expect(
        defined((await t.db.select().from(user).where(eq(user.id, "member")))[0]).departmentId,
      ).toBe(art);
      if (revocation !== "removal")
        expect(
          defined((await t.db.select().from(user).where(eq(user.id, "admin")))[0]).departmentId,
        ).toBe(art);
      expect(
        await t.db
          .select()
          .from(department)
          .where(eq(department.name, "Unauthorized new department")),
      ).toEqual([]);
    });
  }
}
