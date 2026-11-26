import { beforeEach, describe, expect, test } from "bun:test";
import {
  athlete,
  sportDivision,
  sportRegistration,
  sportRegistrationChange,
  user,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { MOVE_FULL, TEAM_FULL } from "../registrations/shared";
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
  await t.seedUser("tech", { department: "Tech/Live", seat: "head", institution: "kmitl" });
  await t.seedUser("tech-staff", { department: "Tech/Live" });
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

  test("counts each status under the other filters and pages by the filtered total", async () => {
    await t.db
      .update(sportRegistration)
      .set({ status: "approved" })
      .where(eq(sportRegistration.userId, "kmutt-1"));
    type Page = { counts: Record<string, number>; total: number; pageCount: number };
    const all = (await send<Page>("tech", "GET", "/")).body;
    expect(all.counts).toEqual({ review: 2, approved: 1, rejected: 0 });
    expect([all.total, all.pageCount]).toEqual([3, 1]);
    // The status filter narrows the list and total, but not the counts.
    const approved = (await send<Page>("tech", "GET", "/?status=approved")).body;
    expect(approved.counts).toEqual(all.counts);
    expect(approved.total).toBe(1);
    // Scope still applies: kmutt staff count only their own.
    const kmutt = (await send<Page>("kmutt-staff", "GET", "/")).body;
    expect(kmutt.counts).toEqual({ review: 1, approved: 1, rejected: 0 });
  });

  test("sorts by shirt number, newest and name; an unknown sort is refused", async () => {
    await t.db
      .update(sportRegistration)
      .set({ shirtNumber: 3, createdAt: new Date("2026-01-01") })
      .where(eq(sportRegistration.userId, "kmutt-2"));
    const order = async (sort: string) =>
      (await send<{ items: Item[] }>("tech", "GET", `/?sort=${sort}`)).body.items.map(
        (item) => item.athlete.userId,
      );
    expect(await order("shirt")).toEqual(["kmutt-2", "kmitl-1", "kmutt-1"]);
    expect((await order("newest")).at(-1)).toBe("kmutt-2");
    expect((await order("oldest"))[0]).toBe("kmutt-2");
    expect((await send("tech", "GET", "/?sort=random")).res.status).toBe(400);
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

  test("other institutions' registration, staff or a leftover seat, cannot review", async () => {
    for (const who of ["kmutt-staff", "kmutt-head"]) {
      const res = await review(who, "r-kmutt-1-football", {
        status: "approved",
        note: "",
        version: 1,
      });
      expect(res.res.status).toBe(403);
    }
  });

  test("Tech/Live staff cannot review either", async () => {
    const res = await review("tech-staff", "r-kmitl-1-football", {
      status: "approved",
      note: "",
      version: 1,
    });
    expect(res.res.status).toBe(403);
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
        await review("reg-head", "r-kmutt-1-football", {
          status: "approved",
          note: "",
          version: 3,
        })
      ).res.status,
    ).toBe(409);
    t.hooks.beforeBatch = () => {
      t.sqlite.run(`update user set institution = 'kmutt' where id = 'reg-head'`);
    };
    expect(
      (
        await review("reg-head", "r-kmutt-1-football", {
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
    for (const who of ["reg-staff", "kmutt-head", "tech-staff"]) {
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

describe("the per-institution limit", () => {
  // Football allows one approved athlete per institution in these tests.
  beforeEach(async () => {
    await t.db
      .update(sportDivision)
      .set({ maxPerInstitution: 1 })
      .where(eq(sportDivision.id, await t.divisionId("football")));
  });
  const approve = (who: string, id: string, version = 1) =>
    send<Item & { message?: string }>(who, "PUT", `/${id}/status`, {
      status: "approved",
      note: "",
      version,
    });
  const statusOf = async (id: string) =>
    defined((await t.db.select().from(sportRegistration).where(eq(sportRegistration.id, id)))[0])
      .status;

  test("counts approvals: the last place goes to whoever is approved first", async () => {
    expect((await approve("tech", "r-kmutt-1-football")).res.status).toBe(200);
    const full = await approve("tech", "r-kmutt-2-football");
    expect(full.res.status).toBe(409);
    expect(full.body.message).toBe(TEAM_FULL);
    // Another institution's places are its own.
    expect((await approve("tech", "r-kmitl-1-football")).res.status).toBe(200);

    // Sending the first back to review frees the place.
    const back = await send("tech", "PUT", "/r-kmutt-1-football/status", {
      status: "review",
      note: "",
      version: 2,
    });
    expect(back.res.status).toBe(200);
    expect((await approve("tech", "r-kmutt-2-football")).res.status).toBe(200);
  });

  test("a place taken between the check and the write refuses the approval", async () => {
    t.hooks.beforeBatch = () => {
      t.sqlite.run(
        "update sport_registration set status = 'approved' where id = 'r-kmutt-1-football'",
      );
    };
    const raced = await approve("tech", "r-kmutt-2-football");
    expect(raced.res.status).toBe(409);
    expect(raced.body.message).toBe(TEAM_FULL);
    expect(await statusOf("r-kmutt-2-football")).toBe("review");
  });

  test("moving an approved athlete into an institution with no place left is refused", async () => {
    await approve("tech", "r-kmutt-1-football");
    await approve("tech", "r-kmitl-1-football");
    const move = {
      shirtNumber: 10,
      badmintonRank: null,
      ign: "",
      ignReading: "",
      facebookUrl: "",
      studentId: "65070999",
      institution: "kmutt",
      version: 2,
    };
    const { res, body } = await send("tech", "PUT", "/r-kmitl-1-football", move);
    expect(res.status).toBe(409);
    expect(body.message).toBe(MOVE_FULL);
    const [account] = await t.db.select().from(user).where(eq(user.id, "kmitl-1"));
    expect(defined(account).institution).toBe("kmitl");

    // Edits that stay put are fine, and so is moving someone not yet approved.
    expect(
      (await send("tech", "PUT", "/r-kmitl-1-football", { ...move, institution: "kmitl" })).res
        .status,
    ).toBe(200);
    await t.db
      .update(sportRegistration)
      .set({ status: "review" })
      .where(eq(sportRegistration.id, "r-kmitl-1-football"));
    expect(
      (await send("tech", "PUT", "/r-kmitl-1-football", { ...move, version: 3 })).res.status,
    ).toBe(200);
  });
});
