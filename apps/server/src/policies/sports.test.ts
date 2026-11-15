import { describe, expect, test } from "bun:test";
import type { Institution } from "@it3k/db/profile";

import { SPORT_PERMISSIONS, type SportActor, sportAccess, sportAccessJson } from "./sports";

const actor = (overrides: Partial<SportActor> = {}): SportActor => ({
  role: "staff",
  leadershipRole: null,
  departmentCode: null,
  institution: null,
  banned: false,
  ...overrides,
});

const registration = (institution: Institution | null, seat: SportActor["leadershipRole"] = null) =>
  actor({ departmentCode: "registration", institution, leadershipRole: seat });

const permissions = (who: SportActor | null) => [...sportAccess(who).can].toSorted();
const ALL = [...SPORT_PERMISSIONS].toSorted();

describe("sport access", () => {
  test("admins and every Tech/Live member run everything", () => {
    for (const who of [
      actor({ role: "admin" }),
      actor({ role: "admin", institution: "kmutt" }),
      actor({ departmentCode: "tech-live" }),
      actor({ departmentCode: "tech-live", leadershipRole: "head" }),
      actor({ departmentCode: "tech-live", leadershipRole: "vicehead", institution: "kmutt" }),
    ]) {
      expect(permissions(who)).toEqual(ALL);
      expect(sportAccess(who).scope).toEqual({ kind: "all" });
    }
  });

  test("host registration head and vicehead run everything", () => {
    for (const seat of ["head", "vicehead"] as const) {
      expect(permissions(registration("kmitl", seat))).toEqual(ALL);
      expect(sportAccess(registration("kmitl", seat)).scope).toEqual({ kind: "all" });
    }
  });

  test("host registration staff only run the kiosk and read athletes", () => {
    expect(permissions(registration("kmitl"))).toEqual(["athletes.read", "kiosk.operate"]);
    expect(sportAccess(registration("kmitl")).scope).toEqual({ kind: "all" });
  });

  test("other institutions' registration read, review and export their own athletes", () => {
    for (const seat of [null, "head", "vicehead"] as const) {
      const who = registration("kmutt", seat);
      expect(permissions(who)).toEqual(["athletes.export", "athletes.read", "athletes.review"]);
      expect(sportAccess(who).scope).toEqual({ kind: "institution", institution: "kmutt" });
    }
  });

  test("registration without an institution gets nothing", () => {
    for (const seat of [null, "head"] as const) {
      expect(permissions(registration(null, seat))).toEqual([]);
      expect(sportAccess(registration(null, seat)).scope).toEqual({ kind: "none" });
    }
  });

  test("other departments, non-members and banned accounts get nothing", () => {
    for (const who of [
      null,
      actor(),
      actor({ departmentCode: "sports", leadershipRole: "head", institution: "kmitl" }),
      actor({ role: "participant", departmentCode: "tech-live" }),
      actor({ role: "athlete", departmentCode: "registration", institution: "kmitl" }),
      actor({ role: "admin", banned: true }),
      actor({ departmentCode: "tech-live", banned: true }),
    ]) {
      expect(permissions(who)).toEqual([]);
    }
  });

  test("the JSON form lists permissions in a stable order", () => {
    expect(sportAccessJson(registration("kmitl"))).toEqual({
      permissions: ["athletes.read", "kiosk.operate"],
      scope: { kind: "all" },
    });
  });
});
