import { describe, expect, test } from "bun:test";

import { hasRole } from "@it3k/auth/permissions";
import { ASSIGN_KINDS } from "@it3k/db/invitation-rules";

import {
  type Action,
  type Actor,
  allowed,
  assignableKinds,
  canRevealContact,
  canAssign,
  canGrantAdmin,
  hasFullAssignRights,
  isManager,
} from "./leadership";

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

  test("staff of Tech/Live or ทะเบียน manage accounts, but not seats", () => {
    for (const departmentCode of ["tech-live", "registration"] as const) {
      const who = actor({ role: "staff", departmentCode });
      expect(isManager(who)).toBe(true);
      for (const action of MANAGE) {
        expect(allowed(who, action, other)).toBe(false);
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

  test("staff manage no seat", () => {
    const who = actor();
    for (const action of MANAGE) {
      expect(allowed(who, action, self)).toBe(false);
    }
  });

  test("admins and leaders see every seat's contact; staff only their own department's", () => {
    const at = (overrides: Partial<Actor>, departmentId: string | null = "art") => ({
      ...actor(overrides),
      departmentId,
    });
    expect(canRevealContact(at({ role: "admin" }, null), "pr")).toBe(true);
    expect(canRevealContact(at({ leadershipRole: "head" }), "pr")).toBe(true);
    expect(canRevealContact(at({ leadershipRole: "vicehead" }), "pr")).toBe(true);
    expect(canRevealContact(at({}), "art")).toBe(true);
    expect(canRevealContact(at({}), "pr")).toBe(false);
    expect(canRevealContact(at({ departmentCode: "tech-live" }), "pr")).toBe(false);
    expect(canRevealContact(at({}, null), "art")).toBe(false);
    expect(canRevealContact(at({ role: "guest" }), "art")).toBe(false);
    expect(canRevealContact(at({ role: "admin", banned: true }), "art")).toBe(false);
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

describe("assignment rights", () => {
  const ALL = [...ASSIGN_KINDS];
  const member = { role: "staff", seatRole: null };
  const seated = { role: "staff", seatRole: "head" as const };
  const plain = { role: "guest", seatRole: null };
  const admin = { role: "admin", seatRole: null };

  const full: [string, Actor][] = [
    ["admin", actor({ role: "admin" })],
    ["tech-live head", actor({ leadershipRole: "head", departmentCode: "tech-live" })],
    ["tech-live vicehead", actor({ leadershipRole: "vicehead", departmentCode: "tech-live" })],
    ["registration head", actor({ leadershipRole: "head", departmentCode: "registration" })],
    [
      "registration vicehead",
      actor({ leadershipRole: "vicehead", departmentCode: "registration" }),
    ],
  ];
  for (const [label, who] of full) {
    test(`${label} gives every kind, to anyone but admins`, () => {
      expect(hasFullAssignRights(who)).toBe(true);
      expect(assignableKinds(who)).toEqual(ALL);
      for (const target of [member, seated, plain]) {
        expect(canAssign(who, "head", target)).toBe(true);
        expect(canAssign(who, "guest", target)).toBe(true);
      }
      expect(canAssign(who, "staff", admin)).toBe(hasRole(who.role, "admin"));
    });
  }

  for (const code of ["tech-live", "registration"]) {
    test(`${code} staff only make non-members guests`, () => {
      const who = actor({ departmentCode: code });
      expect(hasFullAssignRights(who)).toBe(false);
      expect(assignableKinds(who)).toEqual(["guest"]);
      expect(canAssign(who, "guest")).toBe(true);
      expect(canAssign(who, "staff")).toBe(false);
      expect(canAssign(who, "guest", plain)).toBe(true);
      expect(canAssign(who, "guest", { role: "athlete,participant", seatRole: null })).toBe(true);
      expect(canAssign(who, "athlete", plain)).toBe(false);
      expect(canAssign(who, "guest", member)).toBe(false);
      expect(canAssign(who, "guest", seated)).toBe(false);
      expect(canAssign(who, "guest", admin)).toBe(false);
    });
  }

  const none: [string, Actor][] = [
    ["other-department head", actor({ leadershipRole: "head", departmentCode: null })],
    ["other-department staff", actor({ departmentCode: "art" })],
    ["guest", actor({ role: "guest", departmentCode: "tech-live" })],
    [
      "banned tech-live head",
      actor({ leadershipRole: "head", departmentCode: "tech-live", banned: true }),
    ],
  ];
  for (const [label, who] of none) {
    test(`${label} gives nothing`, () => {
      expect(assignableKinds(who)).toEqual([]);
      expect(canAssign(who, "guest")).toBe(false);
      expect(canAssign(who, "guest", plain)).toBe(false);
    });
  }
});
