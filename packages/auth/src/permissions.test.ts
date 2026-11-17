import { describe, expect, test } from "bun:test";

import { primaryRole } from "./permissions";

describe("primaryRole", () => {
  test("picks the highest role a stored role holds", () => {
    expect(primaryRole(null)).toBe("guest");
    expect(primaryRole("guest")).toBe("guest");
    expect(primaryRole("participant")).toBe("participant");
    expect(primaryRole("athlete,participant")).toBe("athlete");
    expect(primaryRole("participant, staff")).toBe("staff");
    expect(primaryRole("staff,admin")).toBe("admin");
  });

  test("ignores roles it does not know", () => {
    expect(primaryRole("superuser")).toBe("guest");
    expect(primaryRole("superuser,athlete")).toBe("athlete");
  });
});
