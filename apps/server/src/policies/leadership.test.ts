import { describe, expect, test } from "bun:test";

import { type Action, type Actor, allowed, canGrantAdmin, isManager } from "./leadership";

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  id: "me",
  role: "staff",
  leadershipRole: null,
  departmentCode: null,
  banned: false,
  ...overrides,
});

const self = { userId: "me" };
const other = { userId: "someone-else" };
const unattached = { userId: null };

const MANAGE: Action[] = ["create", "update", "delete", "attach"];

describe("leadership policy", () => {
  const managers: [string, Actor][] = [
    ["admin", actor({ role: "admin" })],
    ["admin in another department", actor({ role: "admin", departmentCode: null })],
    ["tech-live head", actor({ leadershipRole: "head", departmentCode: "tech-live" })],
    ["tech-live vicehead", actor({ leadershipRole: "vicehead", departmentCode: "tech-live" })],
    ["registration head", actor({ leadershipRole: "head", departmentCode: "registration" })],
    [
      "registration vicehead",
      actor({ leadershipRole: "vicehead", departmentCode: "registration" }),
    ],
  ];

  for (const [label, who] of managers) {
    test(`${label} manages every seat`, () => {
      expect(isManager(who)).toBe(true);
      for (const action of MANAGE) {
        for (const target of [self, other, unattached]) {
          expect(allowed(who, action, target)).toBe(true);
        }
      }
    });
  }

  const outsiders: [string, Actor][] = [
    ["other-department head", actor({ leadershipRole: "head", departmentCode: null })],
    ["other-department vicehead", actor({ leadershipRole: "vicehead", departmentCode: null })],
  ];

  for (const [label, who] of outsiders) {
    test(`${label} may only update their own seat`, () => {
      expect(isManager(who)).toBe(false);
      expect(allowed(who, "update", self)).toBe(true);
      expect(allowed(who, "update", other)).toBe(false);
      expect(allowed(who, "update", unattached)).toBe(false);
      expect(allowed(who, "update")).toBe(false);
      for (const action of ["create", "delete", "attach"] as const) {
        expect(allowed(who, action, self)).toBe(false);
      }
    });
  }

  test("staff of Tech/Live or ทะเบียน are managers", () => {
    for (const departmentCode of ["tech-live", "registration"] as const) {
      const who = actor({ role: "staff", departmentCode });
      expect(isManager(who)).toBe(true);
      for (const action of MANAGE) {
        expect(allowed(who, action, other)).toBe(true);
      }
    }
  });

  test("guests get nothing, not even in a manager department", () => {
    const who = actor({ role: "guest", departmentCode: "tech-live", leadershipRole: "head" });
    expect(isManager(who)).toBe(false);
    for (const action of [...MANAGE, "reveal"] as const) {
      expect(allowed(who, action, self)).toBe(false);
    }
  });

  test("athletes get nothing either", () => {
    const who = actor({ role: "athlete", departmentCode: "tech-live" });
    expect(isManager(who)).toBe(false);
    expect(allowed(who, "reveal", other)).toBe(false);
  });

  test("only admins grant admin", () => {
    expect(canGrantAdmin(actor({ role: "admin" }))).toBe(true);
    expect(canGrantAdmin(actor({ role: "staff", departmentCode: "tech-live" }))).toBe(false);
    expect(canGrantAdmin(actor({ role: "admin", banned: true }))).toBe(false);
  });

  test("staff may only reveal contacts", () => {
    const who = actor();
    for (const action of MANAGE) {
      expect(allowed(who, action, self)).toBe(false);
    }
    expect(allowed(who, "reveal", other)).toBe(true);
  });

  test("every signed-in, unbanned user may reveal", () => {
    for (const who of [actor(), actor({ leadershipRole: "head" }), actor({ role: "admin" })]) {
      expect(allowed(who, "reveal", other)).toBe(true);
    }
  });

  test("anonymous and banned actors are denied everything", () => {
    const banned = actor({ role: "admin", banned: true });
    for (const action of [...MANAGE, "reveal"] as const) {
      expect(allowed(null, action, self)).toBe(false);
      expect(allowed(banned, action, self)).toBe(false);
    }
    expect(isManager(null)).toBe(false);
    expect(isManager(banned)).toBe(false);
  });

  test("multi-role strings are honoured", () => {
    expect(isManager(actor({ role: "staff,admin" }))).toBe(true);
  });

  test("a leftover 'head' account role grants nothing without a seat", () => {
    const who = actor({ role: "head", departmentCode: "tech-live" });
    expect(isManager(who)).toBe(false);
    expect(allowed(who, "update", self)).toBe(false);
  });
});
