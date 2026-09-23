import { describe, expect, test } from "bun:test";

import { type Action, type Actor, allowed, isManager } from "./leadership-policy";

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  id: "me",
  role: "staff",
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
    ["tech-live head", actor({ role: "head", departmentCode: "tech-live" })],
    ["tech-live vicehead", actor({ role: "vicehead", departmentCode: "tech-live" })],
    ["registration head", actor({ role: "head", departmentCode: "registration" })],
    ["registration vicehead", actor({ role: "vicehead", departmentCode: "registration" })],
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
    ["other-department head", actor({ role: "head", departmentCode: null })],
    ["other-department vicehead", actor({ role: "vicehead", departmentCode: null })],
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

  test("staff in a manager department is not a manager", () => {
    const who = actor({ role: "staff", departmentCode: "tech-live" });
    expect(isManager(who)).toBe(false);
    for (const action of MANAGE) {
      expect(allowed(who, action, self)).toBe(false);
    }
  });

  test("staff may only reveal contacts", () => {
    const who = actor();
    for (const action of MANAGE) {
      expect(allowed(who, action, self)).toBe(false);
    }
    expect(allowed(who, "reveal", other)).toBe(true);
  });

  test("every signed-in, unbanned user may reveal", () => {
    for (const role of ["staff", "head", "vicehead", "admin"]) {
      expect(allowed(actor({ role }), "reveal", other)).toBe(true);
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
    expect(isManager(actor({ role: "staff,vicehead", departmentCode: "tech-live" }))).toBe(true);
  });
});
