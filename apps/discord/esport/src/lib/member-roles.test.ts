import { describe, expect, test } from "bun:test";

import type { MemberInfo } from "./api";
import type { RoleKey } from "./layout";
import { MANAGED_ROLES, planRoleChange, rolesFor } from "./member-roles";

const rov = { divisionCode: "esports-rov", divisionName: "ROV", sportName: "กีฬา Esports", ign: "" };
const tft = { divisionCode: "esports-tft", divisionName: "TFT", sportName: "กีฬา Esports", ign: "" };
const valorant = {
  divisionCode: "esports-valorant",
  divisionName: "Valorant",
  sportName: "กีฬา Esports",
  ign: "",
};

const linked = (fields: Partial<Extract<MemberInfo, { linked: true }>>): MemberInfo => ({
  linked: true,
  banned: false,
  staff: false,
  nickname: null,
  institution: null,
  department: null,
  esports: [],
  ...fields,
});

describe("rolesFor", () => {
  test("an unlinked member gets no roles", () => {
    expect(rolesFor({ linked: false, linkUrl: "https://x/me" }).size).toBe(0);
  });

  test("staff get the staff role", () => {
    expect([...rolesFor(linked({ staff: true }))]).toEqual(["staff"]);
  });

  test("an athlete gets the game and their institution's team for each game", () => {
    const roles = rolesFor(
      linked({
        esports: [
          { ...rov, institution: "kmitl" },
          { ...tft, institution: "kmitl" },
          { ...valorant, institution: "kmitl" },
        ],
      }),
    );
    expect([...roles].sort()).toEqual(["game:rov", "game:tft", "team:rov:kmitl", "team:tft:kmitl"]);
  });

  test("a banned member gets nothing, even with staff and esports", () => {
    expect(
      rolesFor(linked({ banned: true, staff: true, esports: [{ ...rov, institution: "kmutt" }] }))
        .size,
    ).toBe(0);
  });
});

describe("planRoleChange", () => {
  const idOf = (key: RoleKey) => `id-${key}`;

  test("adds what is missing and removes managed roles no longer held in it3k", () => {
    const held = new Set(["id-staff", "id-game:tft", "someone-else's-role"]);
    const change = planRoleChange(new Set<RoleKey>(["game:rov", "team:rov:kmitl"]), held, idOf);
    expect(change.add.sort()).toEqual(["id-game:rov", "id-team:rov:kmitl"]);
    expect(change.remove.sort()).toEqual(["id-game:tft", "id-staff"]);
    expect(change.keep.sort()).toEqual(["game:rov", "team:rov:kmitl"]);
  });

  test("never touches roles it does not manage, nor ones /init has not made", () => {
    const change = planRoleChange(new Set<RoleKey>(["staff"]), new Set(["other"]), () => undefined);
    expect(change).toEqual({ add: [], remove: [], keep: [] });
  });

  test("manages exactly the roles in the layout", () => {
    expect(MANAGED_ROLES).toContain("staff");
    expect(MANAGED_ROLES).toContain("team:mlbb:kmutnb-prachinburi");
  });
});
