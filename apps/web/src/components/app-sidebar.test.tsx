import { describe, expect, test } from "bun:test";

import type { SportPermission } from "@/lib/users";

import { staffNavGroups } from "./app-sidebar";

function sportsMenu(permissions: SportPermission[]) {
  const groups = staffNavGroups({
    canManageUsers: false,
    canManageDepartments: false,
    canSendEmail: false,
    sportAccess: { permissions } as never,
  });
  return groups.find((group) => group.label === "กีฬา")?.items.map((item) => item.to) ?? [];
}

describe("staff menu", () => {
  test("staff outside the sport system see no sport pages", () => {
    expect(sportsMenu([])).toEqual([]);
  });

  test("score keepers of the sports department get teams and matches, not check-in", () => {
    const menu = sportsMenu(["competition.read", "matches.score"]);
    expect(menu).toContain("/staff/teams");
    expect(menu).toContain("/staff/matches");
    expect(menu).not.toContain("/staff/match-checkin");
    expect(menu).not.toContain("/staff/athletes");
  });

  test("those who check athletes in to matches get the check-in page", () => {
    expect(sportsMenu(["competition.read", "matches.checkin"])).toContain("/staff/match-checkin");
  });

  test("other institutions' registration staff see athletes but no competition pages", () => {
    const menu = sportsMenu(["athletes.read", "athletes.export"]);
    expect(menu).toContain("/staff/athletes");
    expect(menu).not.toContain("/staff/teams");
    expect(menu).not.toContain("/staff/matches");
  });
});
