import { beforeEach, describe, expect, test } from "bun:test";
import { sport, sportDivision, user } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createSportRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createSportRoutes>;

const newSport = {
  code: "volleyball",
  name: "กีฬาวอลเลย์บอล",
  description: "",
  icon: "general",
  thumbnailUrl: "",
  sortOrder: 100,
};

const newDivision = {
  code: "volleyball-male",
  name: "วอลเลย์บอล ทีมชาย",
  gender: "male",
  format: "team",
  requiresShirtNumber: true,
  requiresBadmintonRank: false,
  requiresGameProfile: false,
  maxPerInstitution: 12,
  registrationOpen: true,
  sortOrder: 10,
};

beforeEach(async () => {
  t = createTestContext();
  app = createSportRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("reg-head", { department: "ทะเบียน", seat: "head", institution: "kmitl" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("reg-kmutt", { department: "ทะเบียน", institution: "kmutt" });
  await t.seedUser("athlete", { role: "participant" });
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

async function sportId(code: string) {
  const [row] = await t.db.select({ id: sport.id }).from(sport).where(eq(sport.code, code));
  return defined(row).id;
}

describe("reading", () => {
  test("any signed-in account lists the seeded sports with their divisions", async () => {
    const { res, body } = await send("athlete", "GET", "/");
    expect(res.status).toBe(200);
    const items = body.items as { code: string; divisions: { code: string }[] }[];
    expect(items.map((item) => item.code)).toEqual([
      "football",
      "athletics",
      "basketball",
      "table-tennis",
      "chairball",
      "badminton",
      "petanque",
      "folk",
      "esports",
    ]);
    expect(items.flatMap((item) => item.divisions)).toHaveLength(30);
    expect(defined(items.find((i) => i.code === "badminton")).divisions[0]).toMatchObject({
      code: "badminton-singles-male",
      requiresBadmintonRank: true,
    });
    expect(body.canManage).toBe(false);
  });

  test("signed-out requests are refused", async () => {
    const res = await app.request("/", t.as(null));
    expect(res.status).toBe(401);
  });
});

describe("managing", () => {
  test("only catalog managers create sports", async () => {
    for (const who of ["reg-staff", "reg-kmutt", "athlete"]) {
      expect((await send(who, "POST", "/", newSport)).res.status).toBe(403);
    }
    for (const [who, code] of [
      ["admin", "a"],
      ["tech", "b"],
      ["reg-head", "c"],
    ] as const) {
      const { res, body } = await send(who, "POST", "/", { ...newSport, code });
      expect(res.status).toBe(201);
      expect(body).toMatchObject({ code, description: null, thumbnailUrl: null, divisions: [] });
    }
  });

  test("codes are unique and validated", async () => {
    expect((await send("tech", "POST", "/", { ...newSport, code: "football" })).res.status).toBe(
      409,
    );
    expect((await send("tech", "POST", "/", { ...newSport, code: "Foot Ball" })).res.status).toBe(
      400,
    );
    expect(
      (await send("tech", "POST", "/", { ...newSport, thumbnailUrl: "http://x.test/a.png" })).res
        .status,
    ).toBe(400);
  });

  test("updates a sport and its divisions", async () => {
    const id = await sportId("football");
    const patched = await send("tech", "PATCH", `/${id}`, { name: "ฟุตบอล 7 คน" });
    expect(patched.res.status).toBe(200);
    expect(patched.body.name).toBe("ฟุตบอล 7 คน");

    const created = await send("tech", "POST", `/${id}/divisions`, newDivision);
    expect(created.res.status).toBe(201);
    const divisionId = created.body.id as string;
    const closed = await send("tech", "PATCH", `/divisions/${divisionId}`, {
      registrationOpen: false,
      maxPerInstitution: null,
    });
    expect(closed.body).toMatchObject({ registrationOpen: false, maxPerInstitution: null });
    expect((await send("tech", "PATCH", `/${id}`, {})).res.status).toBe(400);
  });

  test("a sport with divisions cannot be deleted until they are", async () => {
    const id = await sportId("football");
    expect((await send("tech", "DELETE", `/${id}`)).res.status).toBe(409);
    const divisions = await t.db
      .select({ id: sportDivision.id })
      .from(sportDivision)
      .where(eq(sportDivision.sportId, id));
    for (const division of divisions) {
      expect((await send("tech", "DELETE", `/divisions/${division.id}`)).res.status).toBe(200);
    }
    expect((await send("tech", "DELETE", `/${id}`)).res.status).toBe(200);
    expect((await send("tech", "DELETE", `/${id}`)).res.status).toBe(404);
  });

  test("a division for a missing sport is a 404", async () => {
    expect((await send("tech", "POST", "/missing/divisions", newDivision)).res.status).toBe(404);
  });

  test("a manager who loses their seat mid-request writes nothing", async () => {
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`delete from leadership where user_id = 'reg-head'`);
    };
    const { res } = await send("reg-head", "POST", "/", newSport);
    expect(res.status).toBe(409);
    expect(await t.db.select().from(sport).where(eq(sport.code, "volleyball"))).toEqual([]);
  });

  test("a manager whose institution changes mid-request writes nothing", async () => {
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`update user set institution = 'kmutt' where id = 'reg-head'`);
    };
    const { res } = await send("reg-head", "POST", "/", newSport);
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(user).where(eq(user.id, "reg-head"));
    expect(defined(row).role).toBe("staff");
  });
});
