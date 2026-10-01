import { describe, expect, test } from "bun:test";

import { DEFAULT_REDIRECT, safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  test("keeps a path on this site, with its search and hash", () => {
    expect(safeRedirect("/staff/links")).toBe("/staff/links");
    expect(safeRedirect("/staff/calendar?view=week#top")).toBe("/staff/calendar?view=week#top");
  });

  test("falls back to the dashboard when there is nothing to return to", () => {
    expect(safeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect("")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect(42)).toBe(DEFAULT_REDIRECT);
  });

  test.each(["//evil.com", "https://evil.com", "/\\evil.com", "/\t/evil.com", "javascript:alert(1)"])(
    "refuses to leave the site: %s",
    (to) => {
      expect(safeRedirect(to)).toBe(DEFAULT_REDIRECT);
    },
  );
});
