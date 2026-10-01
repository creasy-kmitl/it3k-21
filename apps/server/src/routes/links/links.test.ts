import { beforeEach, describe, expect, test } from "bun:test";
import { shortLink, shortLinkChange, shortLinkVisitDay } from "@it3k/db/schema/index";
import { bangkokDay } from "@it3k/db/short-link-rules";
import { eq, sql } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { createLinkRoutes } from ".";

const WEB = "https://it3k.test";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createLinkRoutes>;

type Link = {
  id: string;
  slug: string;
  title: string;
  destination: string;
  enabled: boolean;
  expiresAt: number | null;
  state: string;
  shortUrl: string;
  qrUrl: string;
  owner: { id: string; name: string } | null;
  visits: { qr: number; link: number };
  version: number;
  canEdit: boolean;
};

type Detail = Link & {
  fallbackUrl: string | null;
  tags: string[];
  daily: { day: string; qr: number; link: number }[];
  changes: { action: string; changes: Record<string, [unknown, unknown]>; actorName: string }[];
};

type Page = {
  items: (Link & { tags: string[] })[];
  canCreate: boolean;
  canManageAll: boolean;
  truncated: boolean;
  tags: string[];
};

beforeEach(async () => {
  t = createTestContext();
  app = createLinkRoutes({ ...t.deps, webOrigin: WEB });
  await t.seedUser("admin", { role: "admin", name: "Admin" });
  await t.seedUser("art", { department: "Art", name: "Art Staff" });
  await t.seedUser("art-2", { department: "Art", name: "Other Art" });
  await t.seedUser("tech", { department: "Tech/Live", name: "Tech Staff" });
  await t.seedUser("guest", { role: "guest", name: "Guest" });
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

async function create(overrides: Record<string, unknown> = {}, who = "art") {
  const { res, body } = await send<Link>(who, "POST", "/", {
    title: "ลงทะเบียนนักกีฬา",
    destination: "https://forms.example.com/register",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return body;
}

describe("creating", () => {
  test("any member makes a link with a chosen or random slug", async () => {
    const chosen = await create({ slug: "Register-2026" });
    expect(chosen).toMatchObject({
      slug: "register-2026",
      state: "active",
      shortUrl: `${WEB}/l/register-2026`,
      qrUrl: `${WEB}/l/register-2026?qr`,
      owner: { id: "art", name: "Art Staff" },
      visits: { qr: 0, link: 0 },
      canEdit: true,
    });
    const random = await create({}, "tech");
    expect(random.slug).toMatch(/^[a-z2-9]{7}$/);
    expect(random.slug).not.toMatch(/[01ilo]/);
  });

  test("guests cannot make links", async () => {
    const { res } = await send("guest", "POST", "/", {
      title: "x",
      destination: "https://example.com",
    });
    expect(res.status).toBe(403);
  });

  test("a slug in use is refused", async () => {
    await create({ slug: "register" });
    const { res, body } = await send("tech", "POST", "/", {
      title: "again",
      destination: "https://example.com",
      slug: "register",
    });
    expect(res.status).toBe(409);
    expect(body.code).toBe("slug-taken");
  });

  test("a malformed slug is refused", async () => {
    for (const slug of ["ab", "-start", "end-", "มีไทย", "has space", "a".repeat(65)]) {
      const { res } = await send("art", "POST", "/", {
        title: "x",
        destination: "https://example.com",
        slug,
      });
      expect(res.status).toBe(400);
    }
  });

  test("only safe https destinations are accepted", async () => {
    const cases: [string, string][] = [
      ["not a url", "not-url"],
      ["http://example.com", "not-https"],
      ["javascript:alert(1)", "not-https"],
      ["https://user:pass@example.com", "credentials"],
      [`${WEB}/l/other`, "loop"],
    ];
    for (const [destination, code] of cases) {
      const { res, body } = await send("art", "POST", "/", { title: "x", destination });
      expect(res.status).toBe(400);
      expect(body.code).toBe(code);
    }
    // The web app's other pages are fine to point at.
    await create({ destination: `${WEB}/staff/calendar` });
  });

  test("an expiry must be in the future", async () => {
    const { res, body } = await send("art", "POST", "/", {
      title: "x",
      destination: "https://example.com",
      expiresAt: Date.now() - 1000,
    });
    expect(res.status).toBe(400);
    expect(body.code).toBe("expiry-past");
  });

  test("tags are normalized, merged and limited", async () => {
    const link = await create({ tags: [" Valorant Finals ", "valorant-finals", "PR", ""] });
    expect((link as unknown as { tags: string[] }).tags).toEqual(["valorant-finals", "pr"]);
    const { res } = await send("art", "POST", "/", {
      title: "x",
      destination: "https://example.com",
      tags: ["a", "b", "c", "d", "e", "f"],
    });
    expect(res.status).toBe(400);
  });

  test("a fallback must be safe too, and is named as the field at fault", async () => {
    const { res, body } = await send("art", "POST", "/", {
      title: "x",
      destination: "https://example.com",
      fallbackUrl: "http://example.com",
    });
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: "not-https", field: "fallbackUrl" });
    const blank = await create({ fallbackUrl: "  " });
    expect((blank as unknown as { fallbackUrl: string | null }).fallbackUrl).toBeNull();
  });

  test("records who made it", async () => {
    const link = await create({ slug: "register" });
    const [change] = await t.db
      .select()
      .from(shortLinkChange)
      .where(eq(shortLinkChange.linkId, link.id));
    expect(change).toMatchObject({
      action: "create",
      actorUserId: "art",
      changes: {
        slug: [null, "register"],
        destination: [null, "https://forms.example.com/register"],
      },
    });
  });
});

describe("reading", () => {
  test("every member sees every link, with edit rights marked", async () => {
    await create({ title: "Art" });
    await create({ title: "Tech" }, "tech");
    const other = await send<Page>("art-2", "GET", "/");
    expect(other.body.items.map((link) => [link.title, link.canEdit])).toEqual([
      ["Tech", false],
      ["Art", false],
    ]);
    expect(other.body).toMatchObject({ canCreate: true, canManageAll: false });
    const tech = await send<Page>("tech", "GET", "/");
    expect(tech.body.items.every((link) => link.canEdit)).toBe(true);
    expect(tech.body.canManageAll).toBe(true);
    expect((await send("guest", "GET", "/")).res.status).toBe(403);
  });

  test("filters to the viewer's own links and by search", async () => {
    await create({ title: "ลงทะเบียน", slug: "register" });
    await create({ title: "ตารางแข่ง", slug: "schedule" }, "tech");
    const mine = await send<Page>("tech", "GET", "/?mine=1");
    expect(mine.body.items.map((link) => link.slug)).toEqual(["schedule"]);
    const found = await send<Page>("tech", "GET", `/?q=${encodeURIComponent("ลงทะ")}`);
    expect(found.body.items.map((link) => link.slug)).toEqual(["register"]);
    const bySlug = await send<Page>("tech", "GET", "/?q=sched");
    expect(bySlug.body.items.map((link) => link.slug)).toEqual(["schedule"]);
  });

  test("filters by tag and lists every tag in use", async () => {
    await create({ slug: "register", tags: ["valorant", "pr"] });
    await create({ slug: "schedule", tags: ["rov"] }, "tech");
    const all = await send<Page>("art", "GET", "/");
    expect(all.body.tags).toEqual(["pr", "rov", "valorant"]);
    const tagged = await send<Page>("art", "GET", "/?tag=Valorant");
    expect(tagged.body.items.map((link) => link.slug)).toEqual(["register"]);
  });

  test("detail charts 7, 30 or 90 days", async () => {
    const link = await create();
    for (const days of [7, 30, 90]) {
      const { body } = await send<Detail>("art", "GET", `/${link.id}?days=${days}`);
      expect(body.daily).toHaveLength(days);
    }
    expect((await send("art", "GET", `/${link.id}?days=12`)).res.status).toBe(400);
  });

  test("detail has daily visits for 30 days and the change log", async () => {
    const link = await create();
    const today = bangkokDay(Date.now());
    await t.db.insert(shortLinkVisitDay).values([
      { linkId: link.id, day: today, source: "qr", count: 5 },
      { linkId: link.id, day: today, source: "link", count: 2 },
      // Too old for the chart, but still in the totals.
      { linkId: link.id, day: "2020-01-01", source: "qr", count: 100 },
    ]);
    const { res, body } = await send<Detail>("art-2", "GET", `/${link.id}`);
    expect(res.status).toBe(200);
    expect(body.daily).toHaveLength(30);
    expect(body.daily.at(-1)).toEqual({ day: today, qr: 5, link: 2 });
    expect(body.daily.slice(0, -1).every((day) => day.qr === 0 && day.link === 0)).toBe(true);
    expect(body.visits).toEqual({ qr: 105, link: 2 });
    expect(body.changes).toMatchObject([{ action: "create", actorName: "Art Staff" }]);
  });

  test("an unknown link is 404", async () => {
    const { res } = await send("art", "GET", `/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe("editing", () => {
  test("the owner changes the destination; the slug stays", async () => {
    const link = await create({ slug: "register" });
    const { res, body } = await send<Link>("art", "PATCH", `/${link.id}`, {
      destination: "https://forms.example.com/v2",
      version: link.version,
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      slug: "register",
      destination: "https://forms.example.com/v2",
      version: link.version + 1,
    });
    const log = await send<Detail>("art", "GET", `/${link.id}`);
    expect(log.body.changes[0]).toMatchObject({
      action: "update",
      changes: {
        destination: ["https://forms.example.com/register", "https://forms.example.com/v2"],
      },
    });
  });

  test("other members cannot edit; admins and Tech/Live can", async () => {
    const link = await create();
    const refused = await send("art-2", "PATCH", `/${link.id}`, {
      title: "mine now",
      version: 1,
    });
    expect(refused.res.status).toBe(403);
    const tech = await send<Link>("tech", "PATCH", `/${link.id}`, { title: "Tech", version: 1 });
    expect(tech.res.status).toBe(200);
    const admin = await send<Link>("admin", "PATCH", `/${link.id}`, { title: "Admin", version: 2 });
    expect(admin.res.status).toBe(200);
  });

  test("switching off is logged as disable and stops the link", async () => {
    const link = await create();
    const { body } = await send<Link>("art", "PATCH", `/${link.id}`, {
      enabled: false,
      version: 1,
    });
    expect(body).toMatchObject({ enabled: false, state: "disabled" });
    const log = await send<Detail>("art", "GET", `/${link.id}`);
    expect(log.body.changes[0]?.action).toBe("disable");
  });

  test("tags and the fallback can be changed, and are logged", async () => {
    const link = await create();
    const { body } = await send<Detail>("art", "PATCH", `/${link.id}`, {
      tags: ["rov"],
      fallbackUrl: "https://it3k.example/event",
      version: 1,
    });
    expect(body).toMatchObject({ tags: ["rov"], fallbackUrl: "https://it3k.example/event" });
    const log = await send<Detail>("art", "GET", `/${link.id}`);
    expect(log.body.changes[0]?.changes).toEqual({
      tags: [[], ["rov"]],
      fallbackUrl: [null, "https://it3k.example/event"],
    });
  });

  test("an unsafe destination is refused on edit too", async () => {
    const link = await create();
    const { res, body } = await send("art", "PATCH", `/${link.id}`, {
      destination: "http://example.com",
      version: 1,
    });
    expect(res.status).toBe(400);
    expect(body.code).toBe("not-https");
  });

  test("an edit based on an old version is refused", async () => {
    const link = await create();
    await send("art", "PATCH", `/${link.id}`, { title: "first", version: 1 });
    const { res } = await send("art", "PATCH", `/${link.id}`, { title: "second", version: 1 });
    expect(res.status).toBe(409);
  });

  test("a save that races another is rolled back", async () => {
    const link = await create();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update short_link set version = version + 1 where id = '${link.id}'`);
    };
    const { res } = await send("art", "PATCH", `/${link.id}`, { title: "late", version: 1 });
    expect(res.status).toBe(409);
    const [row] = await t.db.select().from(shortLink).where(eq(shortLink.id, link.id));
    expect(row?.title).toBe("ลงทะเบียนนักกีฬา");
    const changes = await t.db
      .select({ n: sql<number>`count(*)` })
      .from(shortLinkChange)
      .where(eq(shortLinkChange.linkId, link.id));
    expect(changes[0]?.n).toBe(1);
  });

  test("losing edit rights mid-save rolls the save back", async () => {
    const link = await create({}, "tech");
    const other = await create({}, "art");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update user set department_id = null where id = 'tech'");
    };
    const { res } = await send("tech", "PATCH", `/${other.id}`, { title: "x", version: 1 });
    expect(res.status).toBe(409);
    // Their own link is still theirs to edit.
    const own = await send("tech", "PATCH", `/${link.id}`, { title: "y", version: 1 });
    expect(own.res.status).toBe(200);
  });
});
