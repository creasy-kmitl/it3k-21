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
  test("admins and the KMITL heads and viceheads of Tech/Live and ทะเบียน run everything", () => {
    for (const who of [
      actor({ role: "admin" }),
      actor({ role: "admin", institution: "kmutt" }),
      actor({ departmentCode: "tech-live", leadershipRole: "head" }),
      actor({ departmentCode: "tech-live", leadershipRole: "vicehead", institution: "kmitl" }),
      registration("kmitl", "head"),
      registration("kmitl", "vicehead"),
      // A seat makes an account KMITL's; one without an institution counts as KMITL's.
      registration(null, "head"),
    ]) {
      expect(permissions(who)).toEqual(ALL);
      expect(sportAccess(who).scope).toEqual({ kind: "all" });
    }
  });

  test("Tech/Live staff of any institution run the kiosk and read athletes", () => {
    for (const institution of [null, "kmutt", "kmitl"] as const) {
      expect(permissions(actor({ departmentCode: "tech-live", institution }))).toEqual([
        "athletes.read",
        "kiosk.operate",
        "rules.edit",
      ]);
    }
  });

  test("a seat holder of another institution, left from before seats were KMITL's, is staff", () => {
    const tech = actor({
      departmentCode: "tech-live",
      leadershipRole: "vicehead",
      institution: "kmutt",
    });
    expect(permissions(tech)).toEqual(["athletes.read", "kiosk.operate", "rules.edit"]);
    expect(permissions(registration("kmutt", "head"))).toEqual([
      "athletes.export",
      "athletes.read",
    ]);
  });

  test("host registration staff run the kiosk, read athletes, edit rules and set institutions", () => {
    expect(permissions(registration("kmitl"))).toEqual([
      "athletes.read",
      "kiosk.operate",
      "rules.edit",
      "users.setInstitution",
    ]);
    expect(sportAccess(registration("kmitl")).scope).toEqual({ kind: "all" });
  });

  test("other institutions' registration staff read and export their own athletes", () => {
    const who = registration("kmutt");
    expect(permissions(who)).toEqual(["athletes.export", "athletes.read"]);
    expect(sportAccess(who).scope).toEqual({ kind: "institution", institution: "kmutt" });
  });

  test("registration staff without an institution get nothing", () => {
    expect(permissions(registration(null))).toEqual([]);
    expect(sportAccess(registration(null)).scope).toEqual({ kind: "none" });
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
      permissions: ["athletes.read", "kiosk.operate", "rules.edit", "users.setInstitution"],
      scope: { kind: "all" },
    });
  });
});
