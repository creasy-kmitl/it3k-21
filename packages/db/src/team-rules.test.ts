import { describe, expect, test } from "bun:test";

import {
  type TeamIssueMember,
  type TeamIssueSettings,
  dealIntoTeams,
  genderFromPrefix,
  nextFreeSeq,
  teamIssues,
  teamLabel,
  teamSizeLimits,
} from "./team-rules";

const football: TeamIssueSettings = {
  format: "team",
  teamMinSize: 11,
  teamMaxSize: 25,
  genderMinimums: null,
  maxOfficials: 3,
};

const approved = (gender: TeamIssueMember["gender"], count: number): TeamIssueMember[] =>
  Array.from({ length: count }, () => ({ gender, status: "approved" }));

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("teamIssues", () => {
  test("a team within every limit has no issues", () => {
    expect(teamIssues(football, approved("male", 11), 3)).toEqual([]);
  });

  test("flags a team below the minimum or above the maximum", () => {
    const few = teamIssues(football, approved("male", 9), 0);
    expect(codes(few)).toEqual(["tooFew"]);
    expect(few[0]?.message).toBe("นักกีฬา 9 คน ต้องมีอย่างน้อย 11 คน");
    expect(codes(teamIssues(football, approved("male", 26), 0))).toEqual(["tooMany"]);
  });

  test("a null size follows the format: one alone, two a pair, any number in a team", () => {
    const pair = { ...football, format: "pair" as const, teamMinSize: null, teamMaxSize: null };
    expect(codes(teamIssues(pair, approved("male", 1), 0))).toEqual(["tooFew"]);
    expect(codes(teamIssues(pair, approved("male", 3), 0))).toEqual(["tooMany"]);
    const open = { ...football, teamMinSize: null, teamMaxSize: null };
    expect(teamIssues(open, approved("male", 60), 0)).toEqual([]);
    expect(codes(teamIssues(open, [], 0))).toEqual(["tooFew"]);
  });

  test("flags each gender minimum not met, ignoring members with no title", () => {
    const tug = {
      ...football,
      teamMinSize: 4,
      teamMaxSize: 8,
      genderMinimums: { male: 2, female: 2 },
    };
    const issues = teamIssues(
      tug,
      [...approved("male", 3), ...approved("female", 1), ...approved(null, 2)],
      0,
    );
    expect(codes(issues)).toEqual(["genderMinimum"]);
    expect(issues[0]?.message).toBe("ต้องมีนักกีฬาหญิงอย่างน้อย 2 คน (มี 1 คน)");
  });

  test("flags members whose registration is no longer approved", () => {
    const members: TeamIssueMember[] = [
      ...approved("male", 10),
      { gender: "male", status: "review" },
      { gender: "male", status: "rejected" },
    ];
    const issues = teamIssues(football, members, 0);
    expect(codes(issues)).toEqual(["notApproved"]);
    expect(issues[0]?.message).toContain("2 คน");
  });

  test("flags too many officials", () => {
    expect(codes(teamIssues(football, approved("male", 11), 4))).toEqual(["tooManyOfficials"]);
  });
});

describe("helpers", () => {
  test("gender comes from the title", () => {
    expect(genderFromPrefix("นาย")).toBe("male");
    expect(genderFromPrefix("นางสาว")).toBe("female");
    expect(genderFromPrefix("นาง")).toBe("female");
    expect(genderFromPrefix("")).toBeNull();
    expect(genderFromPrefix(null)).toBeNull();
  });

  test("size limits", () => {
    expect(teamSizeLimits({ format: "individual", teamMinSize: null, teamMaxSize: null })).toEqual({
      min: 1,
      max: 1,
    });
    expect(teamSizeLimits(football)).toEqual({ min: 11, max: 25 });
  });

  test("labels number a team only when an institution may field several", () => {
    expect(teamLabel({ name: null, institution: "kmutt", seq: 2 }, true)).toBe("มจธ. ทีม 2");
    expect(teamLabel({ name: null, institution: "kmutt", seq: 1 }, false)).toBe("มจธ.");
    expect(teamLabel({ name: "เสือเหลือง", institution: "kmutt", seq: 1 }, true)).toBe("เสือเหลือง");
  });

  test("the next free number fills gaps first", () => {
    expect(nextFreeSeq([])).toBe(1);
    expect(nextFreeSeq([1, 3])).toBe(2);
    expect(nextFreeSeq([2, 1])).toBe(3);
  });

  test("athletes are dealt in turn, ranked ones into their own team first", () => {
    const people = [1, 2, 3, 4, 5].map((id) => ({ id, badmintonRank: null as number | null }));
    expect(dealIntoTeams(people, 2, false).map((team) => team.map((p) => p.id))).toEqual([
      [1, 3, 5],
      [2, 4],
    ]);
    expect(dealIntoTeams(people, 1, false)[0]).toHaveLength(5);
    const ranked = [
      { id: "a", badmintonRank: 2 },
      { id: "b", badmintonRank: 1 },
      { id: "c", badmintonRank: null },
    ];
    expect(dealIntoTeams(ranked, 2, true).map((team) => team.map((p) => p.id))).toEqual([
      ["b", "c"],
      ["a"],
    ]);
  });
});
