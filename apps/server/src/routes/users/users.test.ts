import { beforeEach, describe, expect, test } from "bun:test";
import { leadership, leadershipSocial, user } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";
import { unlockDepartmentCodes } from "@it3k/db/testing";

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
  await t.seedUser("tech-head", { seat: "head", department: "Tech/Live", name: "Tech Head" });
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
    const { res, body } = await assign("tech-head", "guest", { kind: "staff", departmentId: art });
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
    const denied = await assign("tech-head", "admin-2", { kind: "staff", departmentId: art });
    expect(denied.res.status).toBe(403);
    const { body } = await assign("admin", "admin-2", { kind: "head", departmentId: art });
    expect(body).toMatchObject({ role: "admin", seatRole: "head" });
  });

  test("Tech/Live and ทะเบียน staff without a seat only make non-members guests", async () => {
    const art = await t.departmentId("Art");
    await t.seedUser("athlete", { role: "athlete,participant" });
    const staffToGuest = await assign("tech-staff", "athlete", { kind: "guest" });
    expect(staffToGuest.res.status).toBe(200);
    expect(staffToGuest.body).toMatchObject({ role: "guest" });

    const denied = [
      await assign("tech-staff", "guest", { kind: "staff", departmentId: art }),
      await assign("tech-staff", "guest", { kind: "athlete" }),
      await assign("tech-staff", "art-staff", { kind: "guest" }),
      await assign("tech-staff", "reg-vice", { kind: "guest" }),
    ];
    for (const { res } of denied) expect(res.status).toBe(403);
    expect(await stored("art-staff")).toMatchObject({ role: "staff", departmentId: art });
    expect(await seatOf("reg-vice")).toBeDefined();
  });

  test("the list says which accounts and kinds the caller may change", async () => {
    type Page = { items: Account[]; assignableKinds: string[] };
    const staff = (await send<Page>("tech-staff", "GET", "/")).body;
    expect(staff.assignableKinds).toEqual(["guest"]);
    const editable = Object.fromEntries(staff.items.map((a) => [a.id, a.canEdit]));
    expect(editable).toMatchObject({
      guest: true,
      "art-staff": false,
      "reg-vice": false,
      admin: false,
    });

    const head = (await send<Page>("tech-head", "GET", "/")).body;
    expect(head.assignableKinds).toEqual([
      "guest",
      "participant",
      "athlete",
      "staff",
      "head",
      "vicehead",
    ]);
    expect(head.items.find((a) => a.id === "art-staff")?.canEdit).toBe(true);
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

describe("PUT /:id/assignment under concurrent changes", () => {
  for (const change of ["role", "department", "code", "ban", "removal", "seat"] as const) {
    test(`manager ${change} revocation rolls back assignment and contact deletion`, async () => {
      const seat = defined(await seatOf("reg-vice"));
      await t.db
        .insert(leadershipSocial)
        .values({ leadershipId: seat.id, platform: "line", value: "private" });
      t.hooks.beforeBatch = () => {
        t.hooks.beforeBatch = undefined;
        if (change === "role")
          t.sqlite.run("update user set role = 'guest' where id = 'tech-head'");
        if (change === "department")
          t.sqlite.run("update user set department_id = null where id = 'tech-head'");
        if (change === "code") {
          unlockDepartmentCodes(t.sqlite);
          t.sqlite.run(
            "update department set code = null where id = (select department_id from user where id = 'tech-head')",
          );
        }
        if (change === "ban") t.sqlite.run("update user set banned = 1 where id = 'tech-head'");
        if (change === "removal") t.sqlite.run("delete from user where id = 'tech-head'");
        // Without the seat, tech-head is guest-only staff and may not demote reg-vice.
        if (change === "seat") t.sqlite.run("delete from leadership where user_id = 'tech-head'");
      };
      expect((await assign("tech-head", "reg-vice", { kind: "guest" })).res.status).toBe(409);
      expect(await seatOf("reg-vice")).toMatchObject({ id: seat.id });
      expect(await stored("reg-vice")).toMatchObject({ role: "staff" });
      expect(
        await t.db
          .select()
          .from(leadershipSocial)
          .where(eq(leadershipSocial.leadershipId, seat.id)),
      ).toHaveLength(1);
    });
  }
  test("a target made admin meanwhile is not demoted by a non-admin", async () => {
    // tech-head passes the admin check, then an admin promotes the target.
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE user SET role = 'admin' WHERE id = 'art-staff'");
    };
    const { res } = await assign("tech-head", "art-staff", { kind: "guest" });
    expect(res.status).toBe(409);
    expect(await stored("art-staff")).toMatchObject({
      role: "admin",
      departmentId: await t.departmentId("Art"),
    });
  });

  test("a seat that changed hands meanwhile is not deleted", async () => {
    const seat = defined(await seatOf("reg-vice"), "reg-vice's seat");
    await t.db
      .insert(leadershipSocial)
      .values({ leadershipId: seat.id, platform: "line", value: "b.line" });
    // The route reads reg-vice's seat, then it is handed to art-staff.
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE leadership SET user_id = 'art-staff' WHERE id = ?", [seat.id]);
    };
    const { res } = await assign("admin", "reg-vice", { kind: "guest" });
    expect(res.status).toBe(409);
    expect(await seatOf("art-staff")).toMatchObject({ id: seat.id });
    expect(
      await t.db.select().from(leadershipSocial).where(eq(leadershipSocial.leadershipId, seat.id)),
    ).toHaveLength(1);
    expect((await stored("reg-vice"))?.role).toBe("staff");
  });

  test("taking a seat whose holder changed meanwhile is refused", async () => {
    const reg = await t.departmentId("ทะเบียน");
    const seat = defined(await seatOf("reg-vice"), "reg-vice's seat");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE leadership SET user_id = 'tech-staff' WHERE id = ?", [seat.id]);
    };
    const { res } = await assign("admin", "art-staff", { kind: "vicehead", departmentId: reg });
    expect(res.status).toBe(409);
    expect(await seatOf("tech-staff")).toMatchObject({ id: seat.id });
    expect(await seatOf("art-staff")).toBeUndefined();
  });
});

describe("PUT /:id/assignment when a seat moves meanwhile", () => {
  // Moves reg-vice's seat to PR's head right before the batch; the holder stays.
  async function moveSeatOnWrite() {
    const seat = defined(await seatOf("reg-vice"), "reg-vice's seat");
    const pr = await t.departmentId("PR");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("UPDATE leadership SET department_id = ?, role = 'head' WHERE id = ?", [
        pr,
        seat.id,
      ]);
    };
    return { seat, pr };
  }

  test("taking over a seat that moved is refused", async () => {
    const reg = await t.departmentId("ทะเบียน");
    const { seat, pr } = await moveSeatOnWrite();
    const { res } = await assign("admin", "art-staff", { kind: "vicehead", departmentId: reg });
    expect(res.status).toBe(409);
    expect(await seatOf("reg-vice")).toMatchObject({ id: seat.id, departmentId: pr, role: "head" });
    expect(await seatOf("art-staff")).toBeUndefined();
    expect((await stored("art-staff"))?.departmentId).toBe(await t.departmentId("Art"));
  });

  test("keeping a seat that moved is refused", async () => {
    const reg = await t.departmentId("ทะเบียน");
    const { seat, pr } = await moveSeatOnWrite();
    const { res } = await assign("admin", "reg-vice", { kind: "vicehead", departmentId: reg });
    expect(res.status).toBe(409);
    expect(await seatOf("reg-vice")).toMatchObject({ id: seat.id, departmentId: pr, role: "head" });
  });
});

describe("PUT /:id/admin", () => {
  for (const change of ["role", "ban", "removal"] as const) {
    test(`admin ${change} revocation prevents granting admin`, async () => {
      t.hooks.beforeBatch = () => {
        t.hooks.beforeBatch = undefined;
        if (change === "role") t.sqlite.run("update user set role = 'guest' where id = 'admin'");
        if (change === "ban") t.sqlite.run("update user set banned = 1 where id = 'admin'");
        if (change === "removal") t.sqlite.run("delete from user where id = 'admin'");
      };
      expect((await send("admin", "PUT", "/guest/admin", { admin: true })).res.status).toBe(409);
      expect(await stored("guest")).toMatchObject({ role: "guest" });
    });
  }
  test("an in-flight request cannot restore its caller's revoked admin role", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update user set role = 'guest' where id = 'admin'");
    };
    expect((await send("admin", "PUT", "/admin/admin", { admin: true })).res.status).toBe(409);
    expect(await stored("admin")).toMatchObject({ role: "guest" });
  });
  test("a changed target department cannot choose a stale fallback role", async () => {
    await t.db.update(user).set({ role: "admin" }).where(eq(user.id, "art-staff"));
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update user set department_id = null where id = 'art-staff'");
    };
    expect((await send("admin", "PUT", "/art-staff/admin", { admin: false })).res.status).toBe(409);
    expect(await stored("art-staff")).toMatchObject({ role: "admin", departmentId: null });
  });
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

describe("institution", () => {
  const setInstitution = (who: string, id: string, institution: string | null) =>
    send<Record<string, unknown>>(who, "PUT", `/${id}/institution`, { institution });

  test("admins, KMITL's ทะเบียน staff and Tech/Live or ทะเบียน leaders set it", async () => {
    await t.seedUser("reg-head", { seat: "head", department: "ทะเบียน", institution: "kmitl" });
    await t.seedUser("reg-kmitl", { department: "ทะเบียน", institution: "kmitl" });
    // tech-head and reg-vice have no institution: a seat counts as KMITL's.
    for (const who of ["admin", "reg-kmitl", "tech-head", "reg-head", "reg-vice"]) {
      const { res, body } = await setInstitution(who, "art-staff", "kmutt");
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ institution: "kmutt", canSetInstitution: true });
    }
    expect((await stored("art-staff"))?.institution).toBe("kmutt");
    expect((await setInstitution("admin", "art-staff", null)).body.institution).toBeNull();
  });

  test("Tech/Live staff, other institutions' ทะเบียน and other departments cannot", async () => {
    await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmutt" });
    // A seat held from before seats were KMITL's only.
    await t.seedUser("reg-kmutt", { seat: "head", department: "ทะเบียน", institution: "kmutt" });
    await t.seedUser("tech-kmitl", { department: "Tech/Live", institution: "kmitl" });
    await t.seedUser("tech-kmutt", { department: "Tech/Live", institution: "kmutt" });
    for (const who of [
      "reg-staff",
      "reg-kmutt",
      "tech-staff",
      "tech-kmitl",
      "tech-kmutt",
      "art-staff",
    ]) {
      expect((await setInstitution(who, "guest", "kmitl")).res.status).toBe(403);
    }
    expect((await stored("guest"))?.institution).toBeNull();
  });

  test("only admins change an admin's institution", async () => {
    expect((await setInstitution("tech-head", "admin", "kmitl")).res.status).toBe(403);
    expect((await setInstitution("admin", "admin", "kmitl")).res.status).toBe(200);
  });

  test("rejects unknown institutions", async () => {
    expect((await setInstitution("admin", "guest", "harvard")).res.status).toBe(400);
  });

  test("/me reports the caller's sport rights", async () => {
    await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
    expect((await send("reg-staff", "GET", "/me")).body).toMatchObject({
      institution: "kmitl",
      sportAccess: {
        permissions: ["athletes.read", "kiosk.operate", "rules.edit", "users.setInstitution"],
        scope: { kind: "all" },
      },
    });
  });
});

describe("storage quotas", () => {
  const setStorage = (who: string, id: string, storageLimit: number) =>
    send<Record<string, unknown>>(who, "PUT", `/${id}/storage`, {
      storageLimit,
      expectedLimit: 1073741824,
    });

  test("only admins and Tech/Live or ทะเบียน leaders set them", async () => {
    expect((await setStorage("tech-staff", "guest", 5)).res.status).toBe(403);
    expect((await setStorage("tech-head", "guest", 5)).res.status).toBe(200);
    expect((await setStorage("reg-vice", "art-staff", 6)).res.status).toBe(200);
    expect((await stored("art-staff"))?.storageLimit).toBe(6);
  });

  test("the list says where the caller may set one", async () => {
    type Page = { items: (Account & { canSetStorage: boolean })[] };
    const staff = (await send<Page>("tech-staff", "GET", "/")).body;
    expect(staff.items.every((a) => !a.canSetStorage)).toBe(true);
    const head = (await send<Page>("tech-head", "GET", "/")).body;
    expect(head.items.find((a) => a.id === "guest")?.canSetStorage).toBe(true);
    expect(head.items.find((a) => a.id === "admin")?.canSetStorage).toBe(false);
  });
});

describe("seats are KMITL's", () => {
  test("taking a seat makes an account without an institution KMITL's", async () => {
    const art = await t.departmentId("Art");
    const { res } = await assign("admin", "guest", { kind: "head", departmentId: art });
    expect(res.status).toBe(200);
    expect((await stored("guest"))?.institution).toBe("kmitl");
  });

  test("an account of another institution can be staff but not hold a seat", async () => {
    const art = await t.departmentId("Art");
    await t.seedUser("kmutt", { role: "guest", institution: "kmutt" });
    const seat = await assign("admin", "kmutt", { kind: "vicehead", departmentId: art });
    expect(seat.res.status).toBe(400);
    const staff = await assign("admin", "kmutt", { kind: "staff", departmentId: art });
    expect(staff.res.status).toBe(200);
    expect((await stored("kmutt"))?.institution).toBe("kmutt");
  });

  test("a seat holder's institution cannot move away from KMITL", async () => {
    await t.db.update(user).set({ institution: "kmitl" }).where(eq(user.id, "reg-vice"));
    const res = await send("admin", "PUT", "/reg-vice/institution", { institution: "kmutt" });
    expect(res.res.status).toBe(400);
    expect((await stored("reg-vice"))?.institution).toBe("kmitl");
  });

  test("an institution change racing a seat assignment is rolled back", async () => {
    const art = await t.departmentId("Art");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update user set institution = 'kmutt' where id = 'guest'");
    };
    const { res } = await assign("admin", "guest", { kind: "head", departmentId: art });
    expect(res.status).toBe(409);
    expect(await seatOf("guest")).toBeUndefined();
  });
});
