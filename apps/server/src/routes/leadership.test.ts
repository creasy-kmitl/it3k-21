import { beforeEach, describe, expect, test } from "bun:test";
import { leadership, leadershipSocial } from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { createTestContext, readJson } from "../testing";
import { createLeadershipRoutes } from "./leadership";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createLeadershipRoutes>;
const audit = { events: [] as unknown[] };

type Summary = {
  id: string;
  departmentId: string;
  departmentName: string;
  role: "head" | "vicehead";
  userId: string | null;
  name: string;
  nickname: string | null;
  displayName: string;
  canEdit: boolean;
  canDelete: boolean;
};
type Page = { items: Summary[]; page: number; hasMore: boolean; canCreate: boolean };

async function seat(values: {
  department: string;
  role: "head" | "vicehead";
  name: string;
  nickname?: string;
  userId?: string;
  phone?: string;
}) {
  const [row] = await t.db
    .insert(leadership)
    .values({
      departmentId: await t.departmentId(values.department),
      role: values.role,
      name: values.name,
      nickname: values.nickname ?? null,
      userId: values.userId ?? null,
      phone: values.phone ?? null,
    })
    .returning();
  if (!row) throw new Error("seat insert failed");
  return row.id;
}

async function list(userId: string | null, query = "") {
  const res = await app.request(`/${query}`, t.as(userId));
  return { res, body: (await res.json()) as Page };
}

beforeEach(async () => {
  t = createTestContext();
  audit.events = [];
  app = createLeadershipRoutes({
    ...t.deps,
    audit: async (event) => void audit.events.push(event),
  });
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech-head", { role: "head", department: "Tech/Live", name: "Somchai Jaidee" });
  await t.seedUser("art-head", { role: "head", department: "Art", name: "Arthit" });
  await t.seedUser("staff", { role: "staff", department: "Art" });
  await t.seedUser("banned", { role: "admin", banned: true });
});

describe("authentication", () => {
  test("anonymous callers get 401 JSON", async () => {
    const res = await app.request("/", t.as(null));
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ message: "Unauthorized" });
  });

  test("banned callers get 403", async () => {
    const { res } = await list("banned");
    expect(res.status).toBe(403);
  });
});

describe("GET /", () => {
  test("empty roster", async () => {
    const { res, body } = await list("staff");
    expect(res.status).toBe(200);
    expect(body).toEqual({ items: [], page: 1, hasMore: false, canCreate: false });
  });

  test("orders by department order, then head before vicehead", async () => {
    await seat({ department: "Tech/Live", role: "vicehead", name: "TV" });
    await seat({ department: "Art", role: "vicehead", name: "AV" });
    await seat({ department: "Tech/Live", role: "head", name: "TH" });
    await seat({ department: "สวัสดิการ", role: "head", name: "SH" });
    await seat({ department: "Art", role: "head", name: "AH" });
    const { body } = await list("staff");
    // Seed order: สวัสดิการ first ... Art, then Tech/Live last.
    expect(body.items.map((s) => s.name)).toEqual(["SH", "AH", "AV", "TH", "TV"]);
  });

  test("attached seats show the account's current name after the nickname", async () => {
    await seat({
      department: "Tech/Live",
      role: "head",
      name: "Old",
      nickname: "ชาย",
      userId: "tech-head",
    });
    await seat({ department: "Art", role: "head", name: "Stored", nickname: "โอ๊ต" });
    await seat({ department: "PR", role: "head", name: "Plain" });
    const { body } = await list("staff");
    const byDept = Object.fromEntries(body.items.map((s) => [s.departmentName, s]));
    expect(byDept["Tech/Live"]).toMatchObject({
      name: "Somchai Jaidee",
      displayName: "ชาย Somchai Jaidee",
    });
    expect(byDept["Art"]).toMatchObject({ name: "Stored", displayName: "โอ๊ต Stored" });
    expect(byDept["PR"]).toMatchObject({ name: "Plain", displayName: "Plain" });
  });

  test("never exposes phone, socials or account email", async () => {
    const id = await seat({
      department: "Tech/Live",
      role: "head",
      name: "A",
      userId: "tech-head",
      phone: "0812345678",
    });
    await t.db
      .insert(leadershipSocial)
      .values({ leadershipId: id, platform: "line", value: "secret-line" });
    for (const path of ["/", `/${id}`, "/?q=A"]) {
      const res = await app.request(path, t.as("staff"));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("0812345678");
      expect(text).not.toContain("secret-line");
      expect(text).not.toContain("@example.com");
      expect(text).not.toContain("phone");
      expect(text).not.toContain("socials");
    }
  });

  test("filters by department", async () => {
    await seat({ department: "Art", role: "head", name: "AH" });
    await seat({ department: "PR", role: "head", name: "PH" });
    const art = await t.departmentId("Art");
    const { body } = await list("staff", `?departmentId=${art}`);
    expect(body.items.map((s) => s.name)).toEqual(["AH"]);
  });

  test("paginates 20 at a time", async () => {
    const names = [
      "สวัสดิการ",
      "สถานที่",
      "พิธีการ",
      "พาเหรด",
      "พัสดุ",
      "พยาบาล",
      "ประสานงาน",
      "ทะเบียน",
      "กีฬา",
      "การเงิน",
      "Sponsor",
    ];
    for (const department of names) {
      await seat({ department, role: "head", name: `${department} H` });
      await seat({ department, role: "vicehead", name: `${department} V` });
    }
    const first = await list("staff");
    expect(first.body.items).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    const second = await list("staff", "?page=2");
    expect(second.body).toMatchObject({ page: 2, hasMore: false });
    expect(second.body.items.map((s) => s.name)).toEqual(["Sponsor H", "Sponsor V"]);
  });

  test("rejects bad query parameters", async () => {
    for (const query of [
      "?page=0",
      "?page=abc",
      "?page=1.5",
      `?departmentId=${"x".repeat(65)}`,
      "?departmentId=",
      "?other=1",
    ]) {
      const { res } = await list("staff", query);
      expect(res.status).toBe(400);
    }
  });

  test("reports whether the caller can create seats", async () => {
    expect((await list("admin")).body.canCreate).toBe(true);
    expect((await list("tech-head")).body.canCreate).toBe(true);
    expect((await list("art-head")).body.canCreate).toBe(false);
    expect((await list("staff")).body.canCreate).toBe(false);
  });

  test("computes per-row permissions on the server", async () => {
    await seat({ department: "Art", role: "head", name: "Mine", userId: "art-head" });
    await seat({ department: "PR", role: "head", name: "Theirs" });
    const own = (await list("art-head")).body.items;
    // PR is seeded before Art; the attached seat shows the account name.
    expect(own.map((s) => [s.name, s.canEdit, s.canDelete])).toEqual([
      ["Theirs", false, false],
      ["Arthit", true, false],
    ]);
    const managed = (await list("tech-head")).body.items;
    expect(managed.every((s) => s.canEdit && s.canDelete)).toBe(true);
    const staff = (await list("staff")).body.items;
    expect(staff.some((s) => s.canEdit || s.canDelete)).toBe(false);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await seat({ department: "Art", role: "head", name: "สมชาย ใจดี", nickname: "ชาย" });
    await seat({ department: "Art", role: "vicehead", name: "100% sure" });
    await seat({ department: "PR", role: "head", name: "a_b" });
    await seat({ department: "PR", role: "vicehead", name: "axb" });
    await seat({ department: "Sponsor", role: "head", name: "back\\slash" });
    await seat({ department: "Tech/Live", role: "head", name: "Ignored", userId: "tech-head" });
  });

  const search = async (q: string) =>
    (await list("staff", `?q=${encodeURIComponent(q)}`)).body.items.map((s) => s.name);

  test("matches Thai substrings in names and nicknames", async () => {
    expect(await search("ใจ")).toEqual(["สมชาย ใจดี"]);
    expect(await search("ชาย")).toEqual(["สมชาย ใจดี"]);
  });

  test("matches the attached account's name and the department name", async () => {
    expect(await search("jaidee")).toEqual(["Somchai Jaidee"]);
    expect(await search("sponsor")).toEqual(["back\\slash"]);
  });

  test("is case-insensitive for ASCII", async () => {
    expect(await search("SURE")).toEqual(["100% sure"]);
  });

  test("treats % _ and \\ literally", async () => {
    expect(await search("%")).toEqual(["100% sure"]);
    expect(await search("a_b")).toEqual(["a_b"]);
    expect(await search("\\")).toEqual(["back\\slash"]);
  });

  test("blank query returns everything", async () => {
    expect(await search("   ")).toHaveLength(6);
  });

  test("no match is an empty page", async () => {
    expect(await search("ไม่มี")).toEqual([]);
  });

  test("limits the query to 64 code points", async () => {
    const ok = await list("staff", `?q=${encodeURIComponent("ก".repeat(64))}`);
    expect(ok.res.status).toBe(200);
    const tooLong = await list("staff", `?q=${encodeURIComponent("ก".repeat(65))}`);
    expect(tooLong.res.status).toBe(400);
    // Astral characters count once each, not as two UTF-16 units.
    const emoji = await list("staff", `?q=${encodeURIComponent("😀".repeat(64))}`);
    expect(emoji.res.status).toBe(200);
  });
});

describe("GET /:id", () => {
  test("returns one summary", async () => {
    const id = await seat({ department: "Art", role: "head", name: "AH" });
    const res = await app.request(`/${id}`, t.as("staff"));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toMatchObject({
      id,
      name: "AH",
      role: "head",
      departmentName: "Art",
    });
  });

  test("unknown id is a 404 and a malformed id is a 400", async () => {
    let res = await app.request(`/${crypto.randomUUID()}`, t.as("staff"));
    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ message: expect.any(String) });
    res = await app.request("/not-a-uuid", t.as("staff"));
    expect(res.status).toBe(400);
  });
});

describe("GET /departments", () => {
  test("lists departments for any signed-in user", async () => {
    const res = await app.request("/departments", t.as("staff"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string }[];
    expect(body).toHaveLength(16);
    expect(body[0]).toEqual({ id: expect.any(String), name: "สวัสดิการ" });
  });
});

async function send(userId: string | null, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: res.status === 204 ? null : await readJson(res) };
}

async function socialsOf(id: string) {
  const rows = await t.db
    .select({ platform: leadershipSocial.platform, value: leadershipSocial.value })
    .from(leadershipSocial)
    .where(eq(leadershipSocial.leadershipId, id));
  return rows.sort((a, b) => a.platform.localeCompare(b.platform));
}

async function stored(id: string) {
  const [row] = await t.db.select().from(leadership).where(eq(leadership.id, id));
  return row;
}

describe("POST /", () => {
  const input = async (overrides: Record<string, unknown> = {}) => ({
    departmentId: await t.departmentId("Art"),
    role: "head",
    name: "New Head",
    socials: [],
    ...overrides,
  });

  for (const manager of ["admin", "tech-head", "reg-vice"]) {
    test(`${manager} creates a seat`, async () => {
      await t.seedUser("reg-vice", { role: "vicehead", department: "ทะเบียน" });
      const { res, body } = await send(
        manager,
        "POST",
        "/",
        await input({
          nickname: "นิว",
          phone: "081-234-5678",
          socials: [
            { platform: "line", value: "new.head" },
            { platform: "instagram", value: "https://instagram.com/new.head" },
          ],
        }),
      );
      expect(res.status).toBe(201);
      expect(body).toMatchObject({
        departmentName: "Art",
        role: "head",
        name: "New Head",
        nickname: "นิว",
        displayName: "นิว New Head",
        canEdit: true,
        canDelete: true,
      });
      expect(JSON.stringify(body)).not.toContain("081-234-5678");
      const id = String(body?.id);
      expect((await stored(id))?.phone).toBe("081-234-5678");
      expect(await socialsOf(id)).toEqual([
        { platform: "instagram", value: "https://instagram.com/new.head" },
        { platform: "line", value: "new.head" },
      ]);
    });
  }

  test("other leaders and staff cannot create", async () => {
    for (const who of ["art-head", "staff"]) {
      const { res } = await send(who, "POST", "/", await input());
      expect(res.status).toBe(403);
    }
    expect(await t.db.select().from(leadership)).toEqual([]);
  });

  test("stores blank phone and nickname as null", async () => {
    const { res, body } = await send(
      "admin",
      "POST",
      "/",
      await input({ phone: "  ", nickname: "" }),
    );
    expect(res.status).toBe(201);
    const row = await stored(String(body?.id));
    expect(row?.phone).toBeNull();
    expect(row?.nickname).toBeNull();
  });

  test("an occupied seat is a 409", async () => {
    await seat({ department: "Art", role: "head", name: "Taken" });
    const { res, body } = await send("admin", "POST", "/", await input());
    expect(res.status).toBe(409);
    expect(body).toEqual({ message: expect.any(String) });
  });

  test("an account can only hold one seat", async () => {
    await seat({ department: "Art", role: "head", name: "Taken", userId: "art-head" });
    const { res } = await send(
      "admin",
      "POST",
      "/",
      await input({ role: "vicehead", userId: "art-head" }),
    );
    expect(res.status).toBe(409);
  });

  test("attaching requires the account to belong to the seat's department", async () => {
    const { res, body } = await send("admin", "POST", "/", await input({ userId: "tech-head" }));
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ message: expect.any(String) });
    const ok = await send("admin", "POST", "/", await input({ userId: "art-head" }));
    expect(ok.res.status).toBe(201);
    expect(ok.body).toMatchObject({ userId: "art-head", name: "Arthit" });
  });

  test("unknown department or account is a 404", async () => {
    let { res } = await send("admin", "POST", "/", await input({ departmentId: "missing" }));
    expect(res.status).toBe(404);
    ({ res } = await send("admin", "POST", "/", await input({ userId: "missing" })));
    expect(res.status).toBe(404);
  });

  test("rejects malformed input", async () => {
    const bad = [
      { name: "" },
      { name: "x".repeat(101) },
      { nickname: "x".repeat(41) },
      { phone: "call me" },
      { role: "boss" },
      { id: crypto.randomUUID() },
      { extra: true },
      { socials: [{ platform: "myspace", value: "x" }] },
      { socials: [{ platform: "line", value: "" }] },
      {
        socials: [
          { platform: "line", value: "a" },
          { platform: "line", value: "b" },
        ],
      },
      { socials: [{ platform: "other", value: "javascript:alert(1)" }] },
      { socials: [{ platform: "other", value: "http://insecure.example" }] },
      { socials: [{ platform: "line", value: "x", extra: 1 }] },
      {
        socials: ["facebook", "instagram", "line", "discord", "other", "other"].map(
          (platform, i) => ({
            platform,
            value: `v${i}`,
          }),
        ),
      },
    ];
    for (const overrides of bad) {
      const { res } = await send("admin", "POST", "/", await input(overrides));
      expect({ overrides, status: res.status }).toEqual({ overrides, status: 400 });
    }
    const { res } = await send("admin", "POST", "/", "not json");
    expect(res.status).toBe(400);
  });
});

describe("PATCH /:id", () => {
  let artHeadSeat: string;
  let prSeat: string;

  beforeEach(async () => {
    artHeadSeat = await seat({
      department: "Art",
      role: "head",
      name: "A",
      userId: "art-head",
      phone: "0800000000",
    });
    await t.db
      .insert(leadershipSocial)
      .values({ leadershipId: artHeadSeat, platform: "line", value: "old" });
    prSeat = await seat({ department: "PR", role: "head", name: "P" });
  });

  test("a leader outside the manager departments edits their own contact fields", async () => {
    const { res, body } = await send("art-head", "PATCH", `/${artHeadSeat}`, {
      nickname: "อาร์ต",
      phone: "",
      socials: [{ platform: "discord", value: "arthit#1" }],
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ displayName: "อาร์ต Arthit", canEdit: true, canDelete: false });
    expect((await stored(artHeadSeat))?.phone).toBeNull();
    expect(await socialsOf(artHeadSeat)).toEqual([{ platform: "discord", value: "arthit#1" }]);
  });

  test("they cannot move, rename, re-role or re-attach their seat", async () => {
    const forged = [
      { departmentId: await t.departmentId("PR") },
      { role: "vicehead" },
      { userId: null },
      { userId: "staff" },
      { name: "Renamed" },
    ];
    for (const json of forged) {
      const { res } = await send("art-head", "PATCH", `/${artHeadSeat}`, json);
      expect({ json, status: res.status }).toEqual({ json, status: 403 });
    }
    expect(await stored(artHeadSeat)).toMatchObject({
      role: "head",
      userId: "art-head",
      name: "A",
    });
  });

  test("they cannot edit another seat; staff cannot edit at all", async () => {
    expect((await send("art-head", "PATCH", `/${prSeat}`, { nickname: "x" })).res.status).toBe(403);
    expect((await send("staff", "PATCH", `/${prSeat}`, { nickname: "x" })).res.status).toBe(403);
  });

  test("an attached staff account still cannot edit (role is required)", async () => {
    await t.seedUser("pr-staff", { department: "PR" });
    await t.db.update(leadership).set({ userId: "pr-staff" }).where(eq(leadership.id, prSeat));
    expect((await send("pr-staff", "PATCH", `/${prSeat}`, { nickname: "x" })).res.status).toBe(403);
  });

  test("managers edit every field and detach accounts", async () => {
    const { res, body } = await send("tech-head", "PATCH", `/${artHeadSeat}`, {
      role: "vicehead",
      userId: null,
      name: "Detached",
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      role: "vicehead",
      userId: null,
      name: "Detached",
      displayName: "Detached",
    });
    // Omitted socials are left alone.
    expect(await socialsOf(artHeadSeat)).toEqual([{ platform: "line", value: "old" }]);
  });

  test("moving an attached seat to another department is refused", async () => {
    const { res } = await send("admin", "PATCH", `/${artHeadSeat}`, {
      departmentId: await t.departmentId("PR"),
      role: "vicehead",
    });
    expect(res.status).toBe(400);
  });

  test("a failed update leaves socials untouched", async () => {
    // Taking PR's occupied head seat fails, and the social replacement with it.
    await t.db.update(leadership).set({ userId: null }).where(eq(leadership.id, artHeadSeat));
    const { res } = await send("admin", "PATCH", `/${artHeadSeat}`, {
      departmentId: await t.departmentId("PR"),
      socials: [{ platform: "facebook", value: "new" }],
    });
    expect(res.status).toBe(409);
    expect(await socialsOf(artHeadSeat)).toEqual([{ platform: "line", value: "old" }]);
  });

  test("unknown seat is a 404; empty body is a 400", async () => {
    expect(
      (await send("admin", "PATCH", `/${crypto.randomUUID()}`, { nickname: "x" })).res.status,
    ).toBe(404);
    expect((await send("admin", "PATCH", `/${prSeat}`, {})).res.status).toBe(400);
  });
});

describe("DELETE /:id", () => {
  test("managers delete a seat and its socials", async () => {
    const id = await seat({ department: "Art", role: "head", name: "A" });
    await t.db.insert(leadershipSocial).values({ leadershipId: id, platform: "line", value: "x" });
    const { res } = await send("admin", "DELETE", `/${id}`);
    expect(res.status).toBe(204);
    expect(await stored(id)).toBeUndefined();
    expect(await socialsOf(id)).toEqual([]);
  });

  test("leaders cannot delete even their own seat", async () => {
    const id = await seat({ department: "Art", role: "head", name: "A", userId: "art-head" });
    expect((await send("art-head", "DELETE", `/${id}`)).res.status).toBe(403);
    expect((await send("staff", "DELETE", `/${id}`)).res.status).toBe(403);
    expect(await stored(id)).toBeDefined();
  });

  test("unknown seat is a 404", async () => {
    expect((await send("admin", "DELETE", `/${crypto.randomUUID()}`)).res.status).toBe(404);
  });
});

describe("GET /users", () => {
  test("managers search unattached accounts by name, optionally by department", async () => {
    await t.seedUser("art-2", { department: "Art", name: "Arthur" });
    await seat({ department: "Art", role: "head", name: "A", userId: "art-head" });
    const art = await t.departmentId("Art");
    let { res, body } = await send("tech-head", "GET", `/users?q=ar&departmentId=${art}`);
    expect(res.status).toBe(200);
    // art-head is already attached, so only Arthur remains.
    expect(body).toEqual({ items: [{ id: "art-2", name: "Arthur" }], hasMore: false });
    ({ body } = await send("admin", "GET", "/users?q=somchai"));
    expect(body).toEqual({ items: [{ id: "tech-head", name: "Somchai Jaidee" }], hasMore: false });
    expect(JSON.stringify(body)).not.toContain("@");
  });

  test("escapes wildcards", async () => {
    const { body } = await send("admin", "GET", "/users?q=%25");
    expect(body).toEqual({ items: [], hasMore: false });
  });

  test("other leaders and staff are forbidden", async () => {
    for (const who of ["art-head", "staff"]) {
      expect((await send(who, "GET", "/users?q=a")).res.status).toBe(403);
    }
  });
});

test("social values reject control characters", async () => {
  const { res } = await send("admin", "POST", "/", {
    departmentId: await t.departmentId("Art"),
    role: "head",
    name: "X",
    socials: [{ platform: "line", value: "a\u0007b" }],
  });
  expect(res.status).toBe(400);
});
