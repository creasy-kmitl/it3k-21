import { beforeEach, describe, expect, test } from "bun:test";
import { shortLink, shortLinkChange, shortLinkVisitDay } from "@it3k/db/schema/index";
import { bangkokDay } from "@it3k/db/short-link-rules";
import { sql } from "drizzle-orm";

import { createTestContext, readJson } from "../../testing";
import { BULK_MAX, createLinkRoutes } from ".";

const WEB = "https://it3k.test";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createLinkRoutes>;

type Link = { id: string; slug: string; title: string; tags: string[] };
type Refusal = { code: string; rows: { index: number; code: string; field: string }[] };

beforeEach(async () => {
  t = createTestContext();
  app = createLinkRoutes({ ...t.deps, webOrigin: WEB });
  await t.seedUser("art", { department: "Art" });
  await t.seedUser("guest", { role: "guest" });
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

const row = (i: number, extra: Record<string, unknown> = {}) => ({
  title: `บูธ ${i}`,
  destination: `https://example.com/booth/${i}`,
  ...extra,
});

async function count(table: typeof shortLink | typeof shortLinkChange) {
  const [result] = await t.db.select({ n: sql<number>`count(*)` }).from(table);
  return result?.n ?? 0;
}

describe("bulk create", () => {
  test("creates every row in order, with chosen and random slugs, and logs each", async () => {
    const { res, body } = await send<{ items: Link[] }>("art", "POST", "/bulk", {
      links: [row(1, { slug: "Booth-1", tags: ["Booths"] }), row(2), row(3, { slug: "booth-3" })],
    });
    expect(res.status).toBe(201);
    expect(body.items.map((link) => link.title)).toEqual(["บูธ 1", "บูธ 2", "บูธ 3"]);
    expect(body.items[0]).toMatchObject({ slug: "booth-1", tags: ["booths"] });
    expect(body.items[1]?.slug).toMatch(/^[a-z2-9]{7}$/);
    expect(await count(shortLinkChange)).toBe(3);
  });

  test(`handles the most rows allowed (${BULK_MAX}) in one go`, async () => {
    const links = Array.from({ length: BULK_MAX }, (_, i) => row(i, { tags: ["a", "b"] }));
    const { res, body } = await send<{ items: Link[] }>("art", "POST", "/bulk", { links });
    expect(res.status).toBe(201);
    expect(body.items).toHaveLength(BULK_MAX);
    expect(await count(shortLink)).toBe(BULK_MAX);
    const tooMany = await send("art", "POST", "/bulk", { links: [...links, row(999)] });
    expect(tooMany.res.status).toBe(400);
  });

  test("reports every bad row and creates nothing", async () => {
    await send("art", "POST", "/", row(0, { slug: "taken" }));
    const { res, body } = await send<Refusal>("art", "POST", "/bulk", {
      links: [
        row(1, { slug: "dup" }),
        row(2, { destination: "http://example.com" }),
        row(3, { slug: "dup" }),
        row(4, { slug: "taken" }),
        row(5, { fallbackUrl: `${WEB}/l/loop` }),
      ],
    });
    expect(res.status).toBe(400);
    expect(body.code).toBe("rows");
    expect(body.rows.map((r) => [r.index, r.code, r.field])).toEqual([
      [1, "not-https", "destination"],
      [2, "slug-duplicate", "slug"],
      [3, "slug-taken", "slug"],
      [4, "loop", "fallbackUrl"],
    ]);
    expect(await count(shortLink)).toBe(1);
  });

  test("a slug taken while the rows were checked is reported, with nothing created", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(
        "insert into short_link (id, slug, title, destination, owner_id) values ('x', 'late', 'x', 'https://x.example', 'art')",
      );
    };
    const { res, body } = await send<Refusal>("art", "POST", "/bulk", {
      links: [row(1), row(2, { slug: "late" })],
    });
    expect(res.status).toBe(409);
    expect(body.rows).toMatchObject([{ index: 1, code: "slug-taken" }]);
    expect(await count(shortLink)).toBe(1);
  });

  test("guests cannot bulk create", async () => {
    expect((await send("guest", "POST", "/bulk", { links: [row(1)] })).res.status).toBe(403);
  });
});

describe("visits report", () => {
  test("lists visits per link per day within the range, filtered by tag", async () => {
    const { body } = await send<{ items: Link[] }>("art", "POST", "/bulk", {
      links: [row(1, { slug: "one", tags: ["rov"] }), row(2, { slug: "two" })],
    });
    const [one, two] = body.items;
    const today = bangkokDay(Date.now());
    await t.db.insert(shortLinkVisitDay).values([
      { linkId: one?.id ?? "", day: today, source: "qr", count: 3 },
      { linkId: one?.id ?? "", day: today, source: "link", count: 1 },
      { linkId: two?.id ?? "", day: today, source: "qr", count: 2 },
      { linkId: one?.id ?? "", day: "2020-01-01", source: "qr", count: 50 },
    ]);
    const all = await send<{ rows: unknown[]; to: string }>("art", "GET", "/visits?days=7");
    expect(all.body.to).toBe(today);
    expect(all.body.rows).toEqual([
      { slug: "one", title: "บูธ 1", day: today, qr: 3, link: 1 },
      { slug: "two", title: "บูธ 2", day: today, qr: 2, link: 0 },
    ]);
    const tagged = await send<{ rows: { slug: string }[] }>("art", "GET", "/visits?tag=rov");
    expect(tagged.body.rows.map((r) => r.slug)).toEqual(["one"]);
  });
});
