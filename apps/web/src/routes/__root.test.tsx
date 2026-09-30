import { describe, expect, test } from "bun:test";
import { PRELOAD_FONTS } from "@it3k/ui/lib/fonts";

import { fontPreloads } from "./__root";

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
