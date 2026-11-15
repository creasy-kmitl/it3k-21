import { describe, expect, test } from "bun:test";

import { codesWith, hasCapability } from "./department-capabilities";
import { isManager } from "./leadership";
import { canManageAllLinks } from "./short-links";

describe("department capabilities", () => {
  test("no code, an ordinary code or a near miss grants nothing", () => {
    for (const code of [null, "art", "finance", "Tech-Live", "tech-live ", "", "constructor"]) {
      expect(hasCapability(code, "manageAccounts")).toBe(false);
      expect(hasCapability(code, "manageShortLinks")).toBe(false);
    }
  });

  test("tech-live manages accounts and short links; registration only accounts", () => {
    expect(codesWith("manageAccounts").toSorted()).toEqual(["registration", "tech-live"]);
    expect(codesWith("manageShortLinks")).toEqual(["tech-live"]);
  });

  test("tech-live runs sports; registration registers athletes", () => {
    expect(codesWith("runSports")).toEqual(["tech-live"]);
    expect(codesWith("registerAthletes")).toEqual(["registration"]);
  });

  test("policies follow the capability map", () => {
    const staff = (departmentCode: string | null) => ({
      id: "me",
      role: "staff",
      leadershipRole: null,
      departmentCode,
      banned: false,
    });
    expect(isManager(staff("registration"))).toBe(true);
    expect(canManageAllLinks(staff("registration"))).toBe(false);
    expect(isManager(staff("tech-live"))).toBe(true);
    expect(canManageAllLinks(staff("tech-live"))).toBe(true);
    expect(isManager(staff("art"))).toBe(false);
    expect(canManageAllLinks(staff("art"))).toBe(false);
    expect(isManager(staff(null))).toBe(false);
  });
});
