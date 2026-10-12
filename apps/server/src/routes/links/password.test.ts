import { describe, expect, test } from "bun:test";

import { hashLinkPassword, verifyLinkPassword } from "./password";

describe("link passwords", () => {
  test("verifies the right password, refuses others, salts every hash", async () => {
    const stored = await hashLinkPassword("ทีมเทค2026");
    expect(stored).toMatch(/^pbkdf2\$10000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyLinkPassword("ทีมเทค2026", stored)).toBe(true);
    expect(await verifyLinkPassword("ทีมเทค2027", stored)).toBe(false);
    expect(await verifyLinkPassword("", stored)).toBe(false);
    expect(await hashLinkPassword("ทีมเทค2026")).not.toBe(stored);
  });

  test("treats a password typed in either Unicode form as the same one", async () => {
    // An accented letter as one code point, and as a letter plus a combining mark.
    const stored = await hashLinkPassword("café");
    expect(await verifyLinkPassword("café", stored)).toBe(true);
  });

  test("a malformed stored value never matches", async () => {
    expect(await verifyLinkPassword("x", "plain-text")).toBe(false);
  });
});
