import { describe, expect, test } from "bun:test";

import { type BracketMatch, type BracketNode, type BracketSide, buildBrackets } from "./bracket";

function side(slot: number, overrides: Partial<BracketSide> = {}): BracketSide {
  return {
    key: `s-${slot}-${Math.random()}`,
    slot,
    name: `ทีม ${slot}`,
    institution: null,
    placeholder: false,
    score: null,
    won: false,
    lost: false,
    sourceMatchId: null,
    sourceResult: null,
    ...overrides,
  };
}

const from = (slot: number, matchId: string, result: "winner" | "loser" = "winner") =>
  side(slot, { sourceMatchId: matchId, sourceResult: result, placeholder: true });

function match(id: string, sides: BracketSide[], overrides: Partial<BracketMatch> = {}) {
  return {
    id,
    divisionId: "d-football",
    divisionName: "ฟุตบอลชาย",
    sportId: "s-football",
    sportName: "ฟุตบอล",
    sportIcon: "football",
    stageName: "รอบน็อกเอาต์",
    matchNo: null,
    startAt: null,
    status: "scheduled",
    version: 1,
    sides,
    ...overrides,
  } satisfies BracketMatch;
}

/** The tree as nested ids, for readable expectations. */
const shape = (node: BracketNode): unknown =>
  node.feeders.length === 0 ? node.match.id : [node.match.id, node.feeders.map(shape)];

describe("buildBrackets", () => {
  test("semis feed the final; the third-place match is its own tree after it", () => {
    const brackets = buildBrackets([
      match("group", [side(1), side(2)]),
      match("sf1", [side(1), side(2)]),
      match("sf2", [side(1), side(2)]),
      match("final", [from(1, "sf1"), from(2, "sf2")]),
      match("third", [from(1, "sf1", "loser"), from(2, "sf2", "loser")]),
    ]);
    expect(brackets).toHaveLength(1);
    expect(brackets[0]?.roots.map(shape)).toEqual([["final", ["sf1", "sf2"]], "third"]);
  });

  test("feeders follow side order and rounds nest", () => {
    const brackets = buildBrackets([
      match("qf1", [side(1), side(2)]),
      match("qf2", [side(1), side(2)]),
      match("qf3", [side(1), side(2)]),
      match("sf1", [from(1, "qf2"), from(2, "qf1")]),
      match("sf2", [from(1, "qf3"), side(2)]),
      match("final", [from(1, "sf1"), from(2, "sf2")]),
    ]);
    expect(brackets[0]?.roots.map(shape)).toEqual([
      [
        "final",
        [
          ["sf1", ["qf2", "qf1"]],
          ["sf2", ["qf3"]],
        ],
      ],
    ]);
  });

  test("divisions without links have no bracket; a loop is drawn once", () => {
    expect(buildBrackets([match("a", [side(1), side(2)])])).toEqual([]);
    const looped = buildBrackets([
      match("a", [from(1, "b"), side(2)]),
      match("b", [from(1, "a"), side(2)]),
    ]);
    const ids = JSON.stringify(looped[0]?.roots.map(shape));
    expect(ids.match(/"a"/g)).toHaveLength(1);
    expect(ids.match(/"b"/g)).toHaveLength(1);
  });

  test("each division gets its own bracket", () => {
    const brackets = buildBrackets([
      match("f1", [side(1), side(2)]),
      match("f2", [from(1, "f1"), side(2)]),
      match("b1", [side(1), side(2)], { divisionId: "d-basket", divisionName: "บาส" }),
      match("b2", [from(1, "b1"), side(2)], { divisionId: "d-basket", divisionName: "บาส" }),
    ]);
    expect(brackets.map((b) => b.divisionId).toSorted()).toEqual(["d-basket", "d-football"]);
  });
});
