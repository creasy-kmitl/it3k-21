import { describe, expect, test } from "bun:test";

import { MIN_TEAMS_FOR_MEDALS } from "./competition-rules";
import { type MedalPlacement, computeMedals, divisionCountsForMedals } from "./medals";
import { INSTITUTION_IDS } from "./profile";

const division = (id: string, teamCount = 4, awardsMedals = true) => ({
  id,
  teamCount,
  awardsMedals,
});

const podium = (divisionId: string, ...order: MedalPlacement["institution"][]) =>
  order.map((institution, index) => ({ divisionId, institution, place: index + 1 }));

describe("computeMedals", () => {
  test("places 1 to 4 earn 4, 3, 2 and 1 points", () => {
    const rows = computeMedals({
      divisions: [division("football")],
      placements: podium("football", "kmutt", "kmitl", "kmutnb-bangkok", "kmutnb-prachinburi"),
      institutions: INSTITUTION_IDS,
    });
    expect(rows.map((row) => [row.institution, row.points, row.rank])).toEqual([
      ["kmutt", 4, 1],
      ["kmitl", 3, 2],
      ["kmutnb-bangkok", 2, 3],
      ["kmutnb-prachinburi", 1, 4],
    ]);
    expect(rows[0]).toMatchObject({ gold: 1, silver: 0, bronze: 0, fourth: 0 });
    expect(rows[3]).toMatchObject({ gold: 0, fourth: 1 });
  });

  test("friendlies and divisions without medals count for nobody", () => {
    const rows = computeMedals({
      divisions: [
        division("small", MIN_TEAMS_FOR_MEDALS - 1),
        division("no-medals", 4, false),
        division("real", MIN_TEAMS_FOR_MEDALS),
      ],
      placements: [
        ...podium("small", "kmitl", "kmutt"),
        ...podium("no-medals", "kmitl", "kmutt", "kmutnb-bangkok"),
        ...podium("real", "kmutt", "kmutnb-bangkok", "kmitl"),
        // Place 5 earns nothing; an unknown division counts for nobody.
        { divisionId: "real", institution: "kmitl", place: 5 },
        { divisionId: "ghost", institution: "kmitl", place: 1 },
      ],
      institutions: ["kmitl", "kmutt", "kmutnb-bangkok"],
    });
    expect(rows.map((row) => [row.institution, row.points])).toEqual([
      ["kmutt", 4],
      ["kmutnb-bangkok", 3],
      ["kmitl", 2],
    ]);
    expect(divisionCountsForMedals(division("small", MIN_TEAMS_FOR_MEDALS - 1))).toBe(false);
  });

  test("level points go to golds, then silvers, then bronzes", () => {
    // kmitl: gold + fourth = 5, and kmutnb-prachinburi the same: a full tie.
    // kmutt: silver + bronze = 5, and kmutnb-bangkok the same.
    const level = computeMedals({
      divisions: [division("a"), division("b")],
      placements: [
        ...podium("a", "kmitl", "kmutt", "kmutnb-bangkok", "kmutnb-prachinburi"),
        ...podium("b", "kmutnb-prachinburi", "kmutnb-bangkok", "kmutt", "kmitl"),
      ],
      institutions: INSTITUTION_IDS,
    });
    expect(level.map((row) => [row.institution, row.points, row.rank])).toEqual([
      ["kmitl", 5, 1],
      ["kmutnb-prachinburi", 5, 1],
      ["kmutt", 5, 3],
      ["kmutnb-bangkok", 5, 3],
    ]);

    // kmitl: silver = 3. kmutt: bronze + fourth = 3. The silver wins.
    const silver = computeMedals({
      divisions: [division("a"), division("b")],
      placements: [
        ...podium("a", "kmutnb-bangkok", "kmitl", "kmutt"),
        { divisionId: "b", institution: "kmutt", place: 4 },
      ],
      institutions: ["kmutt", "kmitl", "kmutnb-bangkok"],
    });
    expect(silver.map((row) => [row.institution, row.points, row.rank])).toEqual([
      ["kmutnb-bangkok", 4, 1],
      ["kmitl", 3, 2],
      ["kmutt", 3, 3],
    ]);
  });

  test("tied places both earn, and institutions without places still show", () => {
    const rows = computeMedals({
      divisions: [division("athletics")],
      placements: [
        { divisionId: "athletics", institution: "kmitl", place: 3 },
        { divisionId: "athletics", institution: "kmutt", place: 3 },
      ],
      institutions: INSTITUTION_IDS,
    });
    expect(rows.map((row) => [row.institution, row.bronze, row.points, row.rank])).toEqual([
      ["kmitl", 1, 2, 1],
      ["kmutt", 1, 2, 1],
      ["kmutnb-bangkok", 0, 0, 3],
      ["kmutnb-prachinburi", 0, 0, 3],
    ]);
  });
});
