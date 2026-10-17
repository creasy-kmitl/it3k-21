import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { leadership, leadershipSocial, user } from "@it3k/db/schema/index";
import { createTestContext, defined } from "../../testing";
import { createLeadershipRoutes } from ".";
import { createUserRoutes } from "../users";

for (const operation of ["create", "edit", "delete"] as const) {
  for (const revocation of ["role", "ban", "removal", "department", "code"] as const) {
    test(`${operation} rolls back after the manager loses ${revocation} authorization`, async () => {
      const t = createTestContext();
      const isAdmin = revocation === "role";
      await t.seedUser("manager", {
        role: isAdmin ? "admin" : "staff",
        department: isAdmin ? "Art" : "Tech/Live",
      });
      await t.seedUser("holder", { department: "Art", seat: "head" });
      const app = createLeadershipRoutes({ ...t.deps, audit: async () => {} });
      const current = defined((await t.db.select().from(leadership))[0]);
      await t.db
        .insert(leadershipSocial)
        .values({ leadershipId: current.id, platform: "line", value: "original" });
      const tech = await t.departmentId("Tech/Live");
      const art = await t.departmentId("Art");
      t.hooks.beforeBatch = () => {
        t.hooks.beforeBatch = undefined;
        if (revocation === "role")
          t.sqlite.run("update user set role = 'staff' where id = 'manager'");
        if (revocation === "ban") t.sqlite.run("update user set banned = 1 where id = 'manager'");
        if (revocation === "removal") t.sqlite.run("delete from user where id = 'manager'");
        if (revocation === "department")
          t.sqlite.run("update user set department_id = ? where id = 'manager'", [art]);
        if (revocation === "code")
          t.sqlite.run("update department set code = null where id = ?", [tech]);
      };
      const [path, method, json] = {
        create: [
          "/",
          "POST",
          { departmentId: tech, role: "head", name: "Restore access", userId: "manager" },
        ],
        edit: [
          `/${current.id}`,
          "PATCH",
          {
            departmentId: tech,
            userId: "manager",
            socials: [{ platform: "line", value: "changed" }],
          },
        ],
        delete: [`/${current.id}`, "DELETE", undefined],
      }[operation] as [string, string, unknown];
      expect((await app.request(path, t.as("manager", { method, json }))).status).toBe(409);
      expect(await t.db.select().from(leadership)).toEqual([current]);
      expect((await t.db.select().from(leadershipSocial)).map((s) => s.value)).toEqual([
        "original",
      ]);
      if (revocation === "role") {
        const me = await createUserRoutes(t.deps).request("/me", t.as("manager"));
        expect(await me.json()).toMatchObject({ canManageUsers: false });
      }
    });
  }
}

for (const revocation of ["role", "ban", "removal", "seat"] as const) {
  test(`self-edit rolls back after ${revocation} revocation`, async () => {
    const t = createTestContext();
    await t.seedUser("leader", { department: "Art", seat: "head" });
    const app = createLeadershipRoutes({ ...t.deps, audit: async () => {} });
    const seat = defined((await t.db.select().from(leadership))[0]);
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      if (revocation === "role") t.sqlite.run("update user set role = 'guest' where id = 'leader'");
      if (revocation === "ban") t.sqlite.run("update user set banned = 1 where id = 'leader'");
      if (revocation === "removal") t.sqlite.run("delete from user where id = 'leader'");
      if (revocation === "seat")
        t.sqlite.run("update leadership set user_id = null where id = ?", [seat.id]);
    };
    expect(
      (
        await app.request(
          `/${seat.id}`,
          t.as("leader", {
            method: "PATCH",
            json: { phone: "0812345678", socials: [{ platform: "line", value: "denied" }] },
          }),
        )
      ).status,
    ).toBe(409);
    expect(defined((await t.db.select().from(leadership))[0]).phone).toBeNull();
    expect(await t.db.select().from(leadershipSocial)).toEqual([]);
  });
}

for (const operation of ["create", "attach"] as const) {
  test(`${operation} promotes a registered participant to staff`, async () => {
    const t = createTestContext();
    await t.seedUser("admin", { role: "admin" });
    await t.seedUser("participant", { role: "participant" });
    const app = createLeadershipRoutes({ ...t.deps, audit: async () => {} });
    const departmentId = await t.departmentId("Art");
    let path = "/";
    let method = "POST";
    let json: unknown = { departmentId, role: "head", name: "Leader", userId: "participant" };
    if (operation === "attach") {
      const [seat] = await t.db
        .insert(leadership)
        .values({ departmentId, role: "head", name: "Vacant" })
        .returning();
      path = `/${defined(seat).id}`;
      method = "PATCH";
      json = { userId: "participant" };
    }
    expect((await app.request(path, t.as("admin", { method, json }))).status).toBe(
      operation === "create" ? 201 : 200,
    );
    expect(
      defined((await t.db.select().from(user).where(eq(user.id, "participant")))[0]),
    ).toMatchObject({ role: "staff", departmentId });
    expect((await app.request("/", t.as("participant"))).status).toBe(200);
  });
}
