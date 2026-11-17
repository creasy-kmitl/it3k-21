import { describe, expect, test } from "bun:test";

import { normalizeHref } from "./rich-text-editor";

describe("normalizeHref", () => {
  test("adds https:// to bare addresses and mailto: to emails", () => {
    expect(normalizeHref(" it3k.creasy.club/events ")).toBe("https://it3k.creasy.club/events");
    expect(normalizeHref("staff@example.com")).toBe("mailto:staff@example.com");
    expect(normalizeHref("http://example.com")).toBe("http://example.com");
    expect(normalizeHref("MAILTO:a@b.co")).toBe("MAILTO:a@b.co");
  });

  test("refuses other schemes and blanks", () => {
    expect(normalizeHref("javascript:alert(1)")).toBe("");
    expect(normalizeHref("data:text/html,hi")).toBe("");
    expect(normalizeHref("   ")).toBe("");
  });
});
