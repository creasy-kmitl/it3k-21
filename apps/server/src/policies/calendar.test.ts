import { describe, expect, test } from "bun:test";

import {
  canCreateItems,
  canEditDepartment,
  canPublishDepartment,
  canReadCalendar,
} from "./calendar";

type Actor = Parameters<typeof canEditDepartment>[0];

const actor = (overrides: Partial<NonNullable<Actor>> = {}): NonNullable<Actor> => ({
  role: "staff",
  banned: false,
  departmentId: "art",
  leadershipRole: null,
  ...overrides,
});

describe("calendar policy", () => {
  test("members and admins read; guests, athletes, the banned and nobody do not", () => {
    expect(canReadCalendar(actor())).toBe(true);
    expect(canReadCalendar(actor({ role: "admin", departmentId: null }))).toBe(true);
    for (const reader of [
      actor({ role: "guest" }),
      actor({ role: "athlete" }),
      actor({ banned: true }),
      null,
    ]) {
      expect(canReadCalendar(reader)).toBe(false);
    }
  });

  test("members edit their own department; admins edit any", () => {
    expect(canEditDepartment(actor(), "art")).toBe(true);
    expect(canEditDepartment(actor(), "registration")).toBe(false);
    expect(canEditDepartment(actor({ role: "admin", departmentId: null }), "registration")).toBe(
      true,
    );
    // Roles are a list; admin anywhere in it counts.
    expect(canEditDepartment(actor({ role: "staff,admin" }), "registration")).toBe(true);
    expect(canEditDepartment(actor({ banned: true }), "art")).toBe(false);
    expect(canEditDepartment(actor({ role: "athlete" }), "art")).toBe(false);
  });

  test("anyone with a department, and admins, may create", () => {
    expect(canCreateItems(actor())).toBe(true);
    expect(canCreateItems(actor({ departmentId: null }))).toBe(false);
    expect(canCreateItems(actor({ role: "admin", departmentId: null }))).toBe(true);
    expect(canCreateItems(actor({ role: "guest" }))).toBe(false);
  });

  test("the department's head and vicehead publish; other seats and members do not", () => {
    expect(canPublishDepartment(actor({ leadershipRole: "head" }), "art")).toBe(true);
    expect(canPublishDepartment(actor({ leadershipRole: "vicehead" }), "art")).toBe(true);
    expect(canPublishDepartment(actor(), "art")).toBe(false);
    // A seat elsewhere does not reach across departments.
    expect(canPublishDepartment(actor({ leadershipRole: "head" }), "registration")).toBe(false);
    expect(canPublishDepartment(actor({ role: "admin", departmentId: null }), "art")).toBe(true);
    expect(canPublishDepartment(actor({ leadershipRole: "head", banned: true }), "art")).toBe(
      false,
    );
  });
});
