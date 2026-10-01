import { beforeEach, describe, expect, test } from "bun:test";
import { shortLink, shortLinkVisitDay } from "@it3k/db/schema/index";
import { bangkokDay } from "@it3k/db/short-link-rules";
import { eq } from "drizzle-orm";

import { createTestContext } from "../../testing";
import { createShortLinkRedirect } from "./redirect";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createShortLinkRedirect>;

beforeEach(async () => {
  t = createTestContext();
  app = createShortLinkRedirect(t.deps);
  await t.seedUser("art", { department: "Art" });
  await t.db.insert(shortLink).values({
    id: "link-1",
    slug: "register",
    title: "Register",
    destination: "https://forms.example.com/register",
    ownerId: "art",
  });
});

const visit = (path: string, init: { method?: string; ua?: string } = {}) =>
  app.request(path, {
    method: init.method ?? "GET",
    headers: { "user-agent": init.ua ?? PHONE },
  });

async function counts() {
  const rows = await t.db
    .select()
    .from(shortLinkVisitDay)
    .where(eq(shortLinkVisitDay.linkId, "link-1"));
  return Object.fromEntries(rows.map((row) => [`${row.day}/${row.source}`, row.count]));
}

describe("redirect", () => {
  test("sends the visitor on, uncached", async () => {
    const res = await visit("/register");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://forms.example.com/register");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("follows a changed destination at once", async () => {
    await visit("/register");
    await t.db
      .update(shortLink)
      .set({ destination: "https://forms.example.com/v2" })
      .where(eq(shortLink.id, "link-1"));
    expect((await visit("/register")).headers.get("location")).toBe("https://forms.example.com/v2");
  });

  test("matches a slug typed in capitals", async () => {
    expect((await visit("/Register")).status).toBe(302);
  });

  test("counts QR and direct visits apart, per Bangkok day", async () => {
    await visit("/register?qr");
    await visit("/register?qr");
    await visit("/register");
    const today = bangkokDay(Date.now());
    expect(await counts()).toEqual({ [`${today}/qr`]: 2, [`${today}/link`]: 1 });
  });

  test("does not count link previews, crawlers or HEAD", async () => {
    for (const ua of ["facebookexternalhit/1.1", "Googlebot/2.1", "WhatsApp/2.23", "Slackbot"]) {
      expect((await visit("/register", { ua })).status).toBe(302);
    }
    expect((await visit("/register", { method: "HEAD" })).status).toBe(302);
    expect(await counts()).toEqual({});
  });

  test("a failed count still redirects", async () => {
    t.sqlite.run("drop table short_link_visit_day");
    const res = await visit("/register");
    expect(res.status).toBe(302);
  });
});

describe("links that do not send anyone on", () => {
  test("unknown or malformed slugs are 404, named for the web page, without echoing the path", async () => {
    for (const path of ["/nope", "/<script>", `/${"a".repeat(80)}`]) {
      const res = await visit(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("x-short-link-unavailable")).toBe("missing");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(await res.text()).toBe("ไม่พบลิงก์นี้");
    }
  });

  test("a switched-off link is 410 and is not counted", async () => {
    await t.db.update(shortLink).set({ enabled: false }).where(eq(shortLink.id, "link-1"));
    const res = await visit("/register?qr");
    expect(res.status).toBe(410);
    expect(res.headers.get("x-short-link-unavailable")).toBe("disabled");
    expect(await counts()).toEqual({});
  });

  test("a switched-off or expired link with a fallback goes there, uncounted", async () => {
    await t.db
      .update(shortLink)
      .set({ enabled: false, fallbackUrl: "https://it3k.example/event" })
      .where(eq(shortLink.id, "link-1"));
    const off = await visit("/register?qr");
    expect(off.status).toBe(302);
    expect(off.headers.get("location")).toBe("https://it3k.example/event");
    await t.db
      .update(shortLink)
      .set({ enabled: true, expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shortLink.id, "link-1"));
    expect((await visit("/register")).headers.get("location")).toBe("https://it3k.example/event");
    expect(await counts()).toEqual({});
  });

  test("an expired link is 410", async () => {
    await t.db
      .update(shortLink)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shortLink.id, "link-1"));
    const res = await visit("/register");
    expect(res.status).toBe(410);
    expect(res.headers.get("x-short-link-unavailable")).toBe("expired");
  });
});
