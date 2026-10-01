import { describe, expect, test } from "bun:test";

import { staffRedirect } from "./route";

describe("staffRedirect", () => {
  test("sends a signed-out visitor to sign in, remembering the page they asked for", () => {
    expect(staffRedirect(undefined, "/staff/calendar?view=week")).toEqual({
      to: "/login",
      search: { to: "/staff/calendar?view=week" },
    });
  });

  test("keeps guests and athletes out", () => {
    expect(staffRedirect({ role: "guest" }, "/staff/dashboard")).toEqual({ to: "/pending" });
    expect(staffRedirect({ role: "athlete" }, "/staff/dashboard")).toEqual({ to: "/pending" });
  });

  test("lets staff and admins in", () => {
    expect(staffRedirect({ role: "staff" }, "/staff/dashboard")).toBeNull();
    expect(staffRedirect({ role: "admin,staff" }, "/staff/dashboard")).toBeNull();
  });
});
