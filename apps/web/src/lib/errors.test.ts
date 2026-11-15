import { afterEach, describe, expect, test } from "bun:test";

import { describeError, isRetryable } from "./errors";
import { ApiError } from "./leadership";

const realOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
}
afterEach(() => {
  // Drop the own property so the prototype getter applies again.
  delete (navigator as { onLine?: boolean }).onLine;
  if (realOnLine) Object.defineProperty(Navigator.prototype, "onLine", realOnLine);
});

describe("describeError", () => {
  test.each([
    ["Failed to fetch"],
    ["Load failed"],
    ["NetworkError when attempting to fetch resource."],
  ])("a failed fetch (%s) is a network problem, worded in Thai", (message) => {
    const info = describeError(new TypeError(message));
    expect(info.kind).toBe("network");
    expect(info.title).toBe("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    expect(info.description).not.toContain(message);
    expect(info.detail).toBe(message);
    expect(info.retryable).toBe(true);
    expect(info.action).toBe("retry");
  });

  test("an offline browser says so, whatever the error text", () => {
    setOnline(false);
    const info = describeError(new TypeError("Failed to fetch"));
    expect(info.kind).toBe("offline");
    expect(info.retryable).toBe(true);
  });

  test("a stale tab missing a route chunk asks for a reload", () => {
    const info = describeError(
      new TypeError("Failed to fetch dynamically imported module: https://x/assets/a.js"),
    );
    expect(info.kind).toBe("outdated");
    expect(info.action).toBe("reload");
    expect(info.retryable).toBe(false);
  });

  test.each([
    [401, "signedOut", "signIn", false],
    [403, "forbidden", "home", false],
    [404, "notFound", "home", false],
    [409, "stale", "retry", true],
    [400, "invalid", "none", false],
    [422, "invalid", "none", false],
    [429, "rateLimited", "retry", true],
    [500, "server", "retry", true],
    [503, "server", "retry", true],
    [418, "unknown", "retry", true],
  ] as const)("HTTP %i is %s", (status, kind, action, retryable) => {
    const info = describeError(new ApiError(status, "Item not found"));
    expect(info.kind).toBe(kind);
    expect(info.action).toBe(action);
    expect(info.retryable).toBe(retryable);
    // English server text stays out of the copy, but is kept for bug reports.
    expect(info.description).not.toContain("Item not found");
    expect(info.detail).toBe(`HTTP ${status}: Item not found`);
  });

  test("a Thai server message is shown as the description", () => {
    const info = describeError(new ApiError(409, "มีคนแก้ไขรายการนี้ก่อนคุณ"));
    expect(info.kind).toBe("stale");
    expect(info.description).toBe("มีคนแก้ไขรายการนี้ก่อนคุณ");
  });

  test("an account switch asks for a reload", () => {
    const info = describeError(new ApiError(403, "Account changed", { code: "ACCOUNT_CHANGED" }));
    expect(info.kind).toBe("accountChanged");
    expect(info.action).toBe("reload");
  });

  test("a client error already written in Thai is shown as is", () => {
    const info = describeError(new Error("ไฟล์ใหญ่เกินไป"));
    expect(info.kind).toBe("unknown");
    expect(info.title).toBe("ดำเนินการไม่สำเร็จ");
    expect(info.description).toBe("ไฟล์ใหญ่เกินไป");
  });

  test("anything else gets generic Thai copy and keeps the raw text aside", () => {
    const info = describeError(new Error("Cannot read properties of undefined"));
    expect(info.kind).toBe("unknown");
    expect(info.description).toMatch(/ไม่คาดคิด/);
    expect(info.detail).toBe("Cannot read properties of undefined");
  });

  test("non-Error values do not crash", () => {
    expect(describeError("boom").detail).toBe("boom");
    expect(describeError(null).kind).toBe("unknown");
  });
});

test("isRetryable skips errors that a retry cannot fix", () => {
  expect(isRetryable(new TypeError("Failed to fetch"))).toBe(true);
  expect(isRetryable(new ApiError(502, "Bad gateway"))).toBe(true);
  expect(isRetryable(new ApiError(403, "Forbidden"))).toBe(false);
  expect(isRetryable(new ApiError(404, "Not found"))).toBe(false);
});

test("a Thai server message that only repeats the heading falls back to the fuller copy", () => {
  const info = describeError(new ApiError(400, "ข้อมูลไม่ถูกต้อง"));
  expect(info.title).toBe("ข้อมูลไม่ถูกต้อง");
  expect(info.description).toBe("ข้อมูลบางส่วนไม่ถูกต้อง ตรวจสอบแล้วลองอีกครั้ง");
});
