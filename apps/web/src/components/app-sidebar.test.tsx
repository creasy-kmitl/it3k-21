import { describe, expect, test } from "bun:test";

import type { SportPermission } from "@/lib/users";

import { staffNavGroups } from "./app-sidebar";

type Rights = { canManageUsers?: boolean; canManageBotTokens?: boolean };

function groupsFor(permissions: SportPermission[], rights: Rights = {}) {
  return staffNavGroups({
    canManageUsers: rights.canManageUsers ?? false,
    canManageDepartments: false,
    canSendEmail: false,
    canManageBotTokens: rights.canManageBotTokens ?? false,
    sportAccess: { permissions } as never,
  });
}

function menu(label: string, permissions: SportPermission[], rights: Rights = {}) {
  return (
    groupsFor(permissions, rights)
      .find((group) => group.label === label)
      ?.items.map((item) => item.to) ?? []
  );
}

const sportsMenu = (permissions: SportPermission[]) => menu("กีฬา", permissions);

describe("staff menu", () => {
  test("groups follow the order of the work", () => {
    const groups = groupsFor(["competition.read", "matches.checkin", "athletes.read"], {
      canManageUsers: true,
    });
    expect(groups.map((group) => group.label)).toEqual([
      "ภาพรวม",
      "องค์กร",
      "กิจกรรม",
      "กีฬา",
      "เครื่องมือ",
    ]);
    expect(menu("กิจกรรม", ["competition.read"])).toEqual(["/staff/events", "/staff/venues"]);
    expect(sportsMenu(["competition.read", "matches.checkin", "athletes.read"])).toEqual([
      "/staff/sports",
      "/staff/athletes",
      "/staff/teams",
      "/staff/matches",
    ]);
  });

  test("every staff member sees the leader directory with the organisation pages", () => {
    expect(menu("องค์กร", [])).toEqual(["/staff/head"]);
    expect(menu("องค์กร", [], { canManageUsers: true })).toEqual(["/staff/head", "/staff/users"]);
  });

  test("staff outside the sport system see no sport or event pages", () => {
    expect(sportsMenu([])).toEqual([]);
    expect(menu("กิจกรรม", [])).toEqual([]);
  });

  test("score keepers of the sports department get teams and matches", () => {
    const menu = sportsMenu(["competition.read", "matches.score"]);
    expect(menu).toContain("/staff/teams");
    expect(menu).toContain("/staff/matches");
    expect(menu).not.toContain("/staff/athletes");
  });

  test("match check-in has no menu of its own: it lives on each match's page", () => {
    expect(sportsMenu(["competition.read", "matches.checkin"])).toEqual([
      "/staff/sports",
      "/staff/teams",
      "/staff/matches",
    ]);
  });

  test("other institutions' registration staff see athletes but no competition pages", () => {
    const menu = sportsMenu(["athletes.read", "athletes.export"]);
    expect(menu).toContain("/staff/athletes");
    expect(menu).not.toContain("/staff/teams");
    expect(menu).not.toContain("/staff/matches");
  });

  test("only those who may manage bot tokens see the page", () => {
    expect(menu("เครื่องมือ", [])).not.toContain("/staff/bot-tokens");
    expect(menu("เครื่องมือ", [], { canManageBotTokens: true })).toContain("/staff/bot-tokens");
  });
});
