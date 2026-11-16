import { describe, expect, test } from "bun:test";
import { PRELOAD_FONTS } from "@it3k/ui/lib/fonts";

import { fontPreloads, siteMeta } from "./__root";

const content = (meta: ReturnType<typeof siteMeta>, key: string) =>
  meta.find((tag) => ("property" in tag ? tag.property : "name" in tag ? tag.name : null) === key)
    ?.content;

describe("siteMeta", () => {
  test("a page without a preview of its own shares the site's", () => {
    const meta = siteMeta({ origin: "https://it3k.test", path: "/me", og: null });
    expect(meta[0]).toEqual({ title: "IT3Kings" });
    expect(content(meta, "og:image")).toBe("https://it3k.test/og.png");
    expect(content(meta, "og:image:width")).toBe("1200");
    expect(content(meta, "og:url")).toBe("https://it3k.test");
  });

  test("a shared event shows its own title, description and cover", () => {
    const meta = siteMeta({
      origin: "https://it3k.test",
      path: "/events/opening",
      og: { title: "พิธีเปิด", description: "ส. 5 ธ.ค.", image: "https://files.test/cover.png" },
    });
    expect(meta[0]).toEqual({ title: "พิธีเปิด · IT3Kings" });
    expect(content(meta, "og:title")).toBe("พิธีเปิด · IT3Kings");
    expect(content(meta, "description")).toBe("ส. 5 ธ.ค.");
    expect(content(meta, "og:url")).toBe("https://it3k.test/events/opening");
    expect(content(meta, "og:image")).toBe("https://files.test/cover.png");
    expect(content(meta, "twitter:image")).toBe("https://files.test/cover.png");
    // An uploaded cover's size is unknown, so none is claimed.
    expect(content(meta, "og:image:width")).toBeUndefined();
  });

  test("an event without a cover falls back to the site picture", () => {
    const meta = siteMeta({
      origin: "https://it3k.test",
      path: "/events",
      og: { title: "กิจกรรม", description: "เปิดรับตั๋ว", image: null },
    });
    expect(content(meta, "og:image")).toBe("https://it3k.test/og.png");
    expect(content(meta, "og:image:width")).toBe("1200");
  });
});

describe("fontPreloads", () => {
  test("preloads the first-paint fonts on server-rendered pages", () => {
    const links = fontPreloads([{ ssr: true }, { ssr: true }]);
    expect(links.map((link) => link.href)).toEqual(PRELOAD_FONTS);
    expect(links[0]).toMatchObject({
      rel: "preload",
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
    });
    // A match that has not resolved ssr yet counts as server-rendered.
    expect(fontPreloads([{}])).toHaveLength(PRELOAD_FONTS.length);
    expect(fontPreloads([{ ssr: "data-only" }])).toHaveLength(PRELOAD_FONTS.length);
  });

  test("skips them when any route on the page renders on the client only", () => {
    expect(fontPreloads([{ ssr: true }, { ssr: false }, { ssr: false }])).toEqual([]);
  });
});
