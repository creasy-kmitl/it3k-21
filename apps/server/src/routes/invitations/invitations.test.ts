import { beforeEach, describe, expect, test } from "bun:test";
import { invitation } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { createInvitationRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createInvitationRoutes>;

type Invite = {
  id: string;
  email: string;
  kind: string;
  department: { id: string; name: string } | null;
  invitedBy: string | null;
  status: "pending" | "expired" | "accepted" | "revoked";
  canManage: boolean;
};

beforeEach(async () => {
  t = createTestContext();
  app = createInvitationRoutes(t.deps);
  await t.seedUser("admin", { role: "admin", name: "Admin" });
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("tech-head", { seat: "head", department: "Tech/Live", name: "Tech Head" });
  await t.seedUser("reg-vice", { seat: "vicehead", department: "ทะเบียน", name: "Reg Vice" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", name: "Reg Staff" });
  await t.seedUser("art-head", { seat: "head", department: "Art", name: "Art Head" });
  await t.seedUser("guest", { role: "guest" });
});

async function send<T = Invite>(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

const invite = (who: string, json: unknown) => send(who, "POST", "/", json);

async function stored(id: string) {
  const [row] = await t.db.select().from(invitation).where(eq(invitation.id, id));
  return row;
}

describe("who may invite", () => {
  test("Tech/Live and ทะเบียน heads, viceheads and admins invite as any kind", async () => {
    const art = await t.departmentId("Art");
    const pr = await t.departmentId("PR");
    const cases: [string, unknown][] = [
      ["admin", { email: "a@gmail.com", kind: "staff", departmentId: art }],
      ["tech-head", { email: "b@gmail.com", kind: "athlete" }],
      ["reg-vice", { email: "c@gmail.com", kind: "head", departmentId: pr }],
      ["tech-head", { email: "d@gmail.com", kind: "participant" }],
    ];
    for (const [who, json] of cases) {
      const { res, body } = await invite(who, json);
      expect(res.status).toBe(201);
      expect(body.status).toBe("pending");
    }
  });

  test("their other staff invite only guests", async () => {
    for (const who of ["tech-staff", "reg-staff"]) {
      const ok = await invite(who, { email: `${who}@gmail.com`, kind: "guest" });
      expect(ok.res.status).toBe(201);
      const denied = await invite(who, { email: `x-${who}@gmail.com`, kind: "athlete" });
      expect(denied.res.status).toBe(403);
    }
  });

  test("other departments, even their heads, and guests cannot", async () => {
    expect((await invite("art-head", { email: "a@gmail.com", kind: "guest" })).res.status).toBe(
      403,
    );
    expect((await invite("guest", { email: "a@gmail.com", kind: "guest" })).res.status).toBe(403);
    expect((await send("art-head", "GET", "/")).res.status).toBe(403);
  });

  test("the list says which kinds the caller may give", async () => {
    const staff = await send<{ assignableKinds: string[] }>("tech-staff", "GET", "/");
    expect(staff.body.assignableKinds).toEqual(["guest"]);
    const head = await send<{ assignableKinds: string[] }>("tech-head", "GET", "/");
    expect(head.body.assignableKinds).toHaveLength(6);
  });
});

describe("institution", () => {
  test("those who may set an account's institution may set it on an invitation", async () => {
    // Admins, KMITL's Tech/Live members and Tech/Live or ทะเบียน leaders.
    await t.seedUser("tech-kmitl", { department: "Tech/Live", institution: "kmitl" });
    for (const who of ["admin", "tech-kmitl", "reg-vice"]) {
      const { res, body } = await invite(who, {
        email: `${who}@gmail.com`,
        kind: "guest",
        institution: "kmutnb-bangkok",
      });
      expect(res.status).toBe(201);
      expect(body).toMatchObject({ institution: "kmutnb-bangkok" });
    }
    expect(t.mail.jobs.map((job) => "invite" in job && job.invite.institution)).toEqual([
      "kmutnb-bangkok",
      "kmutnb-bangkok",
      "kmutnb-bangkok",
    ]);
    const list = await send<{ canSetInstitution: boolean }>("tech-kmitl", "GET", "/");
    expect(list.body.canSetInstitution).toBe(true);
  });

  test("other inviters may invite, but without an institution", async () => {
    // Tech/Live staff outside KMITL and ทะเบียน staff do not set institutions.
    const denied = await invite("tech-staff", {
      email: "a@gmail.com",
      kind: "guest",
      institution: "kmutt",
    });
    expect(denied.res.status).toBe(403);
    const ok = await invite("reg-staff", {
      email: "b@gmail.com",
      kind: "guest",
      institution: null,
    });
    expect(ok.res.status).toBe(201);
    const list = await send<{ canSetInstitution: boolean }>("reg-staff", "GET", "/");
    expect(list.body.canSetInstitution).toBe(false);
  });

  test("an unknown institution is refused", async () => {
    const { res } = await invite("admin", {
      email: "a@gmail.com",
      kind: "guest",
      institution: "mit",
    });
    expect(res.status).toBe(400);
  });

  test("a head or vicehead invitation is KMITL's, whoever sends it", async () => {
    const art = await t.departmentId("Art");
    const refused = await invite("admin", {
      email: "a@gmail.com",
      kind: "head",
      departmentId: art,
      institution: "kmutt",
    });
    expect(refused.res.status).toBe(400);
    // Tech/Live heads without an institution may not choose one, but a seat's is fixed.
    const { res, body } = await invite("tech-head", {
      email: "b@gmail.com",
      kind: "vicehead",
      departmentId: art,
    });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ institution: "kmitl" });
  });

  test("a leader of another institution, from before seats were KMITL's, invites only guests", async () => {
    await t.seedUser("reg-kmutt", { seat: "head", department: "ทะเบียน", institution: "kmutt" });
    const list = await send<{ assignableKinds: string[] }>("reg-kmutt", "GET", "/");
    expect(list.body.assignableKinds).toEqual(["guest"]);
  });

  test("a change to the inviter's sport rights meanwhile rolls the invitation back", async () => {
    await t.seedUser("tech-kmitl", { department: "Tech/Live", institution: "kmitl" });
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update user set institution = 'kmutt' where id = 'tech-kmitl'");
    };
    const { res } = await invite("tech-kmitl", {
      email: "a@gmail.com",
      kind: "guest",
      institution: "kmitl",
    });
    expect(res.status).toBe(409);
    expect(await t.db.select().from(invitation)).toEqual([]);
  });
});

describe("POST /", () => {
  test("stores the address lowercased and queues the email", async () => {
    const art = await t.departmentId("Art");
    const { body } = await invite("tech-head", {
      email: "  Friend@Gmail.COM ",
      kind: "staff",
      departmentId: art,
    });
    expect(body).toMatchObject({
      email: "friend@gmail.com",
      kind: "staff",
      department: { id: art, name: "Art" },
      invitedBy: "Tech Head",
    });
    expect(t.mail.jobs).toEqual([
      {
        kind: "invitation",
        to: { email: "friend@gmail.com" },
        invite: {
          kind: "staff",
          department: "Art",
          institution: null,
          invitedBy: "Tech Head",
          expiresAt: expect.any(Number),
        },
      },
    ]);
  });

  test("a queue failure still creates the invitation", async () => {
    t.mail.failing = true;
    const { res } = await invite("admin", { email: "a@gmail.com", kind: "guest" });
    expect(res.status).toBe(201);
  });

  test("refuses addresses that already have an account, or an open invitation", async () => {
    expect((await invite("admin", { email: "guest@example.com", kind: "guest" })).res.status).toBe(
      409,
    );
    await invite("admin", { email: "a@gmail.com", kind: "guest" });
    const again = await invite("admin", { email: "A@gmail.com", kind: "athlete" });
    expect(again.res.status).toBe(409);
    expect(t.mail.jobs).toHaveLength(1);
  });

  test("checks the department and the seat", async () => {
    const reg = await t.departmentId("ทะเบียน");
    const cases: [unknown, number][] = [
      [{ email: "a@gmail.com", kind: "staff" }, 400],
      [{ email: "a@gmail.com", kind: "guest", departmentId: reg }, 400],
      [{ email: "a@gmail.com", kind: "staff", departmentId: "missing" }, 404],
      [{ email: "a@gmail.com", kind: "vicehead", departmentId: reg }, 409],
      [{ email: "not-an-email", kind: "guest" }, 400],
      [{ email: "a@gmail.com", kind: "admin" }, 400],
    ];
    for (const [json, status] of cases) {
      expect((await invite("admin", json)).res.status).toBe(status);
    }
  });

  test("a head who loses their seat meanwhile is rolled back", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("delete from leadership where user_id = 'tech-head'");
    };
    const { res } = await invite("tech-head", { email: "a@gmail.com", kind: "athlete" });
    expect(res.status).toBe(409);
    expect(await t.db.select().from(invitation)).toEqual([]);
    expect(t.mail.jobs).toEqual([]);
  });
});

describe("resend and revoke", () => {
  async function seeded(kind = "athlete") {
    const { body } = await invite("admin", { email: "a@gmail.com", kind });
    t.mail.jobs.length = 0;
    return body.id;
  }

  test("resend renews an expired invitation and sends again", async () => {
    const id = await seeded();
    await t.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, id));
    expect((await send("tech-head", "GET", "/")).body).toMatchObject({
      items: [{ id, status: "expired", canManage: true }],
    });
    const { res, body } = await send("tech-head", "POST", `/${id}/resend`, {});
    expect(res.status).toBe(200);
    expect(body.status).toBe("pending");
    expect(t.mail.jobs).toHaveLength(1);
  });

  test("revoke closes the invitation for good", async () => {
    const id = await seeded();
    const { body } = await send("reg-vice", "DELETE", `/${id}`);
    expect(body.status).toBe("revoked");
    expect((await stored(id))?.revokedAt).toBeInstanceOf(Date);
    expect((await send("reg-vice", "DELETE", `/${id}`)).res.status).toBe(409);
    expect((await send("reg-vice", "POST", `/${id}/resend`, {})).res.status).toBe(409);
  });

  test("guest-only staff manage guest invitations only", async () => {
    const athlete = await seeded("athlete");
    const { body } = await send<{ items: Invite[] }>("tech-staff", "GET", "/");
    expect(body.items.find((i) => i.id === athlete)?.canManage).toBe(false);
    expect((await send("tech-staff", "DELETE", `/${athlete}`)).res.status).toBe(403);
    expect((await send("tech-staff", "POST", `/${athlete}/resend`, {})).res.status).toBe(403);

    const guest = (await invite("tech-staff", { email: "g@gmail.com", kind: "guest" })).body.id;
    expect((await send("tech-staff", "DELETE", `/${guest}`)).res.status).toBe(200);
  });

  test("an invitation accepted meanwhile is not revoked", async () => {
    const id = await seeded();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update invitation set accepted_at = 1 where id = ?", [id]);
    };
    expect((await send("admin", "DELETE", `/${id}`)).res.status).toBe(409);
    expect((await stored(id))?.revokedAt).toBeNull();
  });
});
