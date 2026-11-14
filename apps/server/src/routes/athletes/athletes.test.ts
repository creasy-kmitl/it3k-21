import { beforeEach, describe, expect, test } from "bun:test";
import { athlete, sportRegistration, sportRegistrationChange, user } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createAthleteRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createAthleteRoutes>;

type Item = {
  id: string;
  status: string;
  institution: string;
  shirtNumber: number | null;
  version: number;
  reviewNote: string | null;
  athlete: { userId: string; studentId: string | null; firstName: string; phone: string };
  division: { code: string };
};

async function registration(
  userId: string,
  code: string,
  institution: "kmitl" | "kmutt",
  extra: Partial<typeof sportRegistration.$inferInsert> = {},
) {
  const id = `r-${userId}-${code}`;
  await t.db
    .insert(sportRegistration)
    .values({ id, userId, divisionId: await t.divisionId(code), institution, ...extra });
  return id;
}

beforeEach(async () => {
  t = createTestContext();
  app = createAthleteRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("reg-head", { department: "ทะเบียน", seat: "head", institution: "kmitl" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
  // One head seat per department, so the other institution's leader is vicehead.
  await t.seedUser("kmutt-head", { department: "ทะเบียน", seat: "vicehead", institution: "kmutt" });
  await t.seedUser("kmutt-staff", { department: "ทะเบียน", institution: "kmutt" });
  await t.seedUser("art", { department: "Art", institution: "kmitl" });
  for (const [id, institution] of [
    ["kmitl-1", "kmitl"],
    ["kmutt-1", "kmutt"],
    ["kmutt-2", "kmutt"],
  ] as const) {
    await t.seedParticipant(id, institution);
    await t.db.update(user).set({ institution }).where(eq(user.id, id));
    await t.db.insert(athlete).values({ userId: id, studentId: `id-${id}` });
  }
  await registration("kmitl-1", "football", "kmitl", { shirtNumber: 7 });
  await registration("kmutt-1", "football", "kmutt", { shirtNumber: 7 });
  await registration("kmutt-2", "football", "kmutt", { shirtNumber: 9 });
});

async function send<T = Record<string, unknown>>(
  userId: string,
  method: string,
  path: string,
  json?: unknown,
) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

const ids = (body: { items: Item[] }) => body.items.map((item) => item.athlete.userId).toSorted();

describe("reading", () => {
  test("managers and host registration see every institution", async () => {
    for (const who of ["admin", "tech", "reg-head", "reg-staff"]) {
      const { res, body } = await send<{ items: Item[] }>(who, "GET", "/");
      expect(res.status).toBe(200);
      expect(ids(body)).toEqual(["kmitl-1", "kmutt-1", "kmutt-2"]);
    }
  });

  test("other institutions' registration see only their own athletes", async () => {
    for (const who of ["kmutt-head", "kmutt-staff"]) {
      const { body } = await send<{ items: Item[] }>(who, "GET", "/?institution=kmitl");
      expect(body.items).toEqual([]);
      expect(ids((await send<{ items: Item[] }>(who, "GET", "/")).body)).toEqual([
        "kmutt-1",
        "kmutt-2",
      ]);
    }
  });

  test("lists carry the profile, student id and the caller's rights", async () => {
    const { body } = await send<{
      items: Item[];
      canReview: boolean;
      canEdit: boolean;
      canExport: boolean;
    }>("reg-staff", "GET", "/?q=id-kmitl");
    expect(body.items).toMatchObject([
      { athlete: { studentId: "id-kmitl-1", firstName: "สมชาย", phone: "0812345678" } },
    ]);
    expect(body).toMatchObject({ canReview: false, canEdit: false, canExport: false });
  });

  test("filters by status, sport and division", async () => {
    await t.db
      .update(sportRegistration)
      .set({ status: "approved" })
      .where(eq(sportRegistration.userId, "kmutt-1"));
    expect(ids((await send<{ items: Item[] }>("tech", "GET", "/?status=approved")).body)).toEqual([
      "kmutt-1",
    ]);
    const badminton = await t.divisionId("badminton-singles-male");
    expect(
      (await send<{ items: Item[] }>("tech", "GET", `/?divisionId=${badminton}`)).body.items,
    ).toEqual([]);
  });

  test("departments without registration rights are refused", async () => {
    expect((await send("art", "GET", "/")).res.status).toBe(403);
  });

  test("export follows the same scope and needs its own right", async () => {
    expect((await send("reg-staff", "GET", "/export")).res.status).toBe(403);
    const { body } = await send<{ items: Item[] }>("kmutt-staff", "GET", "/export");
    expect(ids(body)).toEqual(["kmutt-1", "kmutt-2"]);
  });
});

describe("reviewing", () => {
  const review = (who: string, id: string, json: unknown) =>
    send<Item & { message?: string }>(who, "PUT", `/${id}/status`, json);

  test("other institutions approve and reject their own athletes only", async () => {
    const own = await review("kmutt-staff", "r-kmutt-1-football", {
      status: "approved",
      note: "",
      version: 1,
    });
    expect(own.res.status).toBe(200);
    expect(own.body).toMatchObject({ status: "approved", version: 2 });
    expect(
      (
        await review("kmutt-staff", "r-kmitl-1-football", {
          status: "approved",
          note: "",
          version: 1,
        })
      ).res.status,
    ).toBe(404);
  });

  test("host registration staff cannot review", async () => {
    const res = await review("reg-staff", "r-kmitl-1-football", {
      status: "approved",
      note: "",
      version: 1,
    });
    expect(res.res.status).toBe(403);
  });

  test("rejecting needs a reason, which the athlete gets to see", async () => {
    expect(
      (await review("reg-head", "r-kmitl-1-football", { status: "rejected", note: "", version: 1 }))
        .res.status,
    ).toBe(400);
    const { body } = await review("reg-head", "r-kmitl-1-football", {
      status: "rejected",
      note: "เอกสารไม่ครบ",
      version: 1,
    });
    expect(body).toMatchObject({ status: "rejected", reviewNote: "เอกสารไม่ครบ" });
    const [log] = await t.db.select().from(sportRegistrationChange);
    expect(defined(log)).toMatchObject({
      action: "review",
      actorUserId: "reg-head",
      changes: { status: ["review", "rejected"], reviewNote: [null, "เอกสารไม่ครบ"] },
    });
  });

  test("a stale version or a reviewer who loses their institution writes nothing", async () => {
    expect(
      (
        await review("kmutt-head", "r-kmutt-1-football", {
          status: "approved",
          note: "",
          version: 3,
        })
      ).res.status,
    ).toBe(409);
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`update user set institution = 'kmitl' where id = 'kmutt-head'`);
    };
    expect(
      (
        await review("kmutt-head", "r-kmutt-1-football", {
          status: "approved",
          note: "",
          version: 1,
        })
      ).res.status,
    ).toBe(409);
    const [row] = await t.db
      .select()
      .from(sportRegistration)
      .where(eq(sportRegistration.id, "r-kmutt-1-football"));
    expect(defined(row).status).toBe("review");
  });

  test("reopening a rejected registration whose shirt number was taken is refused", async () => {
    await t.db
      .update(sportRegistration)
      .set({ status: "rejected" })
      .where(eq(sportRegistration.id, "r-kmutt-2-football"));
    await t.db
      .update(sportRegistration)
      .set({ shirtNumber: 9 })
      .where(eq(sportRegistration.id, "r-kmutt-1-football"));
    const { res, body } = await review("tech", "r-kmutt-2-football", {
      status: "review",
      note: "",
      version: 1,
    });
    expect(res.status).toBe(409);
    expect(body.message).toBe("เบอร์เสื้อนี้มีคนในทีมเดียวกันใช้แล้ว");
  });
});

describe("editing", () => {
  const edit = {
    shirtNumber: 10,
    badmintonRank: null,
    ign: "",
    ignReading: "",
    facebookUrl: "",
    studentId: "65070999",
    institution: "kmutt",
    version: 1,
  };

  test("full managers edit fields, the student id and move the account's institution", async () => {
    const { res, body } = await send<Item>("reg-head", "PUT", "/r-kmitl-1-football", edit);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      shirtNumber: 10,
      institution: "kmutt",
      athlete: { studentId: "65070999" },
    });
    const [account] = await t.db.select().from(user).where(eq(user.id, "kmitl-1"));
    expect(defined(account).institution).toBe("kmutt");
  });

  test("only full managers edit", async () => {
    for (const who of ["reg-staff", "kmutt-head"]) {
      expect((await send(who, "PUT", "/r-kmutt-1-football", edit)).res.status).toBe(403);
    }
  });

  test("moving into a team that already has the shirt number is refused", async () => {
    const { res } = await send("tech", "PUT", "/r-kmitl-1-football", { ...edit, shirtNumber: 9 });
    expect(res.status).toBe(409);
    const [account] = await t.db.select().from(user).where(eq(user.id, "kmitl-1"));
    expect(defined(account).institution).toBe("kmitl");
  });
});
