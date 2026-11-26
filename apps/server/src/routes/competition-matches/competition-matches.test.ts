import { beforeEach, describe, expect, test } from "bun:test";
import {
  competitionChange,
  competitionGroup,
  competitionLineup,
  competitionMatch,
  competitionMatchParticipant,
  competitionTeam,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { seedMatch } from "../../competition/testing";
import { createTestContext, defined, readJson } from "../../testing";
import { createCompetitionMatchRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCompetitionMatchRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createCompetitionMatchRoutes(t.deps);
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("sports-head", { department: "กีฬา", seat: "head", institution: "kmitl" });
  await t.seedUser("sports-staff", { department: "กีฬา", institution: "kmitl" });
  await t.seedUser("athlete", { role: "athlete" });
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

type Side = { id: string; slot: number; teamId: string | null; label: string | null; name: string };
type Match = {
  id: string;
  version: number;
  status: string;
  friendly: boolean;
  subOrder: number | null;
  coverImageUrl: string | null;
  participants: Side[];
  referees: { id: string; name: string; role: string }[];
  images: { id: string; isCover: boolean; url: string }[];
  subMatches: Match[];
};

async function seedTeams(code: string, institutions: string[]) {
  const divisionId = await t.divisionId(code);
  const rows = await t.db
    .insert(competitionTeam)
    .values(
      institutions.map((institution) => ({ divisionId, institution: institution as "kmitl" })),
    )
    .returning();
  return { divisionId, teamIds: rows.map((row) => row.id) };
}

const matchBody = (divisionId: string, participants: unknown[], extra: object = {}) => ({
  divisionId,
  parentMatchId: null,
  groupId: null,
  stageName: "รอบแบ่งกลุ่ม",
  roundNo: 1,
  matchNo: 1,
  startAt: Date.UTC(2026, 11, 1, 2),
  venueId: null,
  court: "1",
  friendly: false,
  scoringConfig: null,
  notes: null,
  participants,
  ...extra,
});

const audit = () => t.db.select().from(competitionChange);

describe("reading", () => {
  test("competition readers list matches with their sides; athletes are refused", async () => {
    const { match } = await seedMatch(t);
    const { res, body } = await send("sports-staff", "GET", "/");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ canManage: false, canScore: true });
    const items = body.items as Match[];
    expect(items.map((item) => item.id)).toEqual([match.id]);
    expect(defined(items[0]).participants.map((p) => p.name)).toEqual(["สจล.", "มจธ."]);
    expect((await send("athlete", "GET", "/")).res.status).toBe(403);
  });

  test("filters by division, venue and status", async () => {
    const { divisionId } = await seedMatch(t);
    await seedMatch(t, "basketball-3x3-female");
    expect(
      ((await send("tech", "GET", `/?divisionId=${divisionId}`)).body.items as unknown[]).length,
    ).toBe(1);
    expect(((await send("tech", "GET", "/?status=live")).body.items as unknown[]).length).toBe(0);
    expect(((await send("tech", "GET", "/?venueId=nope")).body.items as unknown[]).length).toBe(0);
    expect((await send("tech", "GET", "/?status=bogus")).res.status).toBe(400);
  });

  test("setup lists a division's teams and says a small division plays friendlies", async () => {
    const { divisionId } = await seedTeams("football", ["kmitl", "kmutt"]);
    const { body } = await send("tech", "GET", `/setup/${divisionId}`);
    expect(body).toMatchObject({ friendlyByDefault: true, nextMatchNo: 1 });
    expect((body.teams as { name: string }[]).map((team) => team.name)).toEqual(["สจล.", "มจธ."]);
    expect((await send("tech", "GET", "/setup/nope")).res.status).toBe(404);
  });

  test("a missing match is 404", async () => {
    expect((await send("tech", "GET", "/nope")).res.status).toBe(404);
  });
});

describe("creating and editing matches", () => {
  test("managers create a match with a team and a placeholder, audited", async () => {
    const { divisionId, teamIds } = await seedTeams("football", [
      "kmitl",
      "kmutt",
      "kmutnb-bangkok",
    ]);
    const { res, body } = await send(
      "sports-head",
      "POST",
      "/",
      matchBody(divisionId, [
        { teamId: teamIds[0], label: null },
        { teamId: null, label: "ผู้ชนะ M3" },
      ]),
    );
    expect(res.status).toBe(201);
    const match = body.match as Match;
    expect(match.participants.map((p) => p.name)).toEqual(["สจล.", "ผู้ชนะ M3"]);
    expect(match.version).toBe(1);
    expect(await audit()).toHaveLength(1);
  });

  test("score keepers may not create; bad teams and venues are refused", async () => {
    const { divisionId, teamIds } = await seedTeams("football", ["kmitl", "kmutt"]);
    const other = await seedTeams("basketball-3x3-female", ["kmitl"]);
    const sides = [
      { teamId: teamIds[0], label: null },
      { teamId: teamIds[1], label: null },
    ];
    expect((await send("sports-staff", "POST", "/", matchBody(divisionId, sides))).res.status).toBe(
      403,
    );
    const wrong = [{ teamId: other.teamIds[0], label: null }];
    expect((await send("tech", "POST", "/", matchBody(divisionId, wrong))).res.status).toBe(400);
    const twice = [sides[0], sides[0]];
    expect((await send("tech", "POST", "/", matchBody(divisionId, twice))).res.status).toBe(400);
    const badVenue = matchBody(divisionId, sides, { venueId: "nope" });
    expect((await send("tech", "POST", "/", badVenue)).res.status).toBe(400);
    const empty = [{ teamId: null, label: "" }];
    expect((await send("tech", "POST", "/", matchBody(divisionId, empty))).res.status).toBe(400);
  });

  test("sub-matches are numbered within their parent", async () => {
    const { divisionId, match, sides } = await seedMatch(t, "table-tennis-doubles-male");
    const body = matchBody(
      divisionId,
      sides.map((side) => ({ teamId: side.teamId, label: null })),
      { parentMatchId: match.id },
    );
    expect((await send("tech", "POST", "/", body)).body.match).toMatchObject({ subOrder: 1 });
    expect((await send("tech", "POST", "/", body)).body.match).toMatchObject({ subOrder: 2 });
    const detail = (await send("tech", "GET", `/${match.id}`)).body.match as Match;
    expect(detail.subMatches.map((sub) => sub.subOrder)).toEqual([1, 2]);
    // The list shows only top-level matches.
    expect(((await send("tech", "GET", "/")).body.items as unknown[]).length).toBe(1);
  });

  test("an edit keeps sides whose team stays and follows the version read", async () => {
    const { divisionId, teamIds } = await seedTeams("football", [
      "kmitl",
      "kmutt",
      "kmutnb-bangkok",
    ]);
    const created = (
      await send(
        "tech",
        "POST",
        "/",
        matchBody(divisionId, [
          { teamId: teamIds[0], label: null },
          { teamId: teamIds[1], label: null },
        ]),
      )
    ).body.match as Match;
    const [home, away] = created.participants;
    const edit = matchBody(
      divisionId,
      [
        { teamId: teamIds[0], label: null },
        { teamId: teamIds[2], label: null },
      ],
      { court: "2", version: created.version },
    );
    const saved = await send("tech", "PUT", `/${created.id}`, edit);
    expect(saved.res.status).toBe(200);
    const match = saved.body.match as Match;
    expect(match.version).toBe(2);
    expect(match.participants[0]?.id).toBe(defined(home).id);
    expect(match.participants[1]?.id).not.toBe(defined(away).id);
    expect(match.participants[1]?.teamId).toBe(teamIds[2] ?? "");

    // The same body again is based on version 1: stale.
    expect((await send("tech", "PUT", `/${created.id}`, edit)).res.status).toBe(409);
  });

  test("a match that has started keeps its sides and cannot be deleted", async () => {
    const { divisionId, match, sides } = await seedMatch(t);
    const [other] = await t.db
      .insert(competitionTeam)
      .values({ divisionId, institution: "kmutnb-bangkok" })
      .returning();
    await t.db
      .update(competitionMatch)
      .set({ status: "live" })
      .where(eq(competitionMatch.id, match.id));
    const edit = matchBody(
      divisionId,
      [
        { teamId: sides[0]?.teamId, label: null },
        { teamId: defined(other).id, label: null },
      ],
      { version: 1 },
    );
    expect((await send("tech", "PUT", `/${match.id}`, edit)).res.status).toBe(400);
    expect((await send("tech", "DELETE", `/${match.id}?version=1`)).res.status).toBe(400);
  });

  test("deleting follows the version and takes the sides with it", async () => {
    const { match } = await seedMatch(t);
    expect((await send("tech", "DELETE", `/${match.id}?version=5`)).res.status).toBe(409);
    expect((await send("tech", "DELETE", `/${match.id}?version=1`)).res.status).toBe(200);
    expect(await t.db.select().from(competitionMatchParticipant)).toHaveLength(0);
    expect((await audit()).map((row) => row.action)).toEqual(["delete"]);
  });
});

describe("status and placeholders", () => {
  test("managers set a manual status, one version at a time", async () => {
    const { match } = await seedMatch(t);
    const first = await send("tech", "POST", `/${match.id}/status`, {
      status: "postponed",
      version: 1,
    });
    expect(first.res.status).toBe(200);
    expect(first.body.match).toMatchObject({ status: "postponed", version: 2 });
    const stale = await send("tech", "POST", `/${match.id}/status`, {
      status: "cancelled",
      version: 1,
    });
    expect(stale.res.status).toBe(409);
    const live = await send("tech", "POST", `/${match.id}/status`, { status: "live", version: 2 });
    expect(live.res.status).toBe(400);
    expect((await audit()).map((row) => row.action)).toEqual(["status"]);
  });

  test("a finished match keeps its status", async () => {
    const { match } = await seedMatch(t);
    await t.db
      .update(competitionMatch)
      .set({ status: "finished" })
      .where(eq(competitionMatch.id, match.id));
    const { res } = await send("tech", "POST", `/${match.id}/status`, {
      status: "scheduled",
      version: 1,
    });
    expect(res.status).toBe(400);
  });

  test("a placeholder side gets its real team; a side with a team does not", async () => {
    const { divisionId, teamIds } = await seedTeams("football", ["kmitl", "kmutt"]);
    const created = (
      await send(
        "tech",
        "POST",
        "/",
        matchBody(divisionId, [
          { teamId: teamIds[0], label: null },
          { teamId: null, label: "ผู้ชนะ M3" },
        ]),
      )
    ).body.match as Match;
    const [home, away] = created.participants.map((p) => p.id);
    const taken = await send("tech", "POST", `/${created.id}/participants/${home}/team`, {
      teamId: teamIds[1],
      version: 1,
    });
    expect(taken.res.status).toBe(400);
    const same = await send("tech", "POST", `/${created.id}/participants/${away}/team`, {
      teamId: teamIds[0],
      version: 1,
    });
    expect(same.res.status).toBe(400);
    const { res, body } = await send("tech", "POST", `/${created.id}/participants/${away}/team`, {
      teamId: teamIds[1],
      version: 1,
    });
    expect(res.status).toBe(200);
    const match = body.match as Match;
    expect(match.participants[1]).toMatchObject({
      teamId: teamIds[1],
      label: "ผู้ชนะ M3",
      name: "มจธ.",
    });
    expect(match.version).toBe(2);
  });
});

describe("referees and images", () => {
  test("managers add, edit and remove referees", async () => {
    const { match } = await seedMatch(t);
    const added = await send("tech", "POST", `/${match.id}/referees`, {
      name: "สมศักดิ์",
      role: "ผู้ตัดสิน",
      sortOrder: 0,
    });
    expect(added.res.status).toBe(201);
    const referee = defined((added.body.match as Match).referees[0]);
    const edited = await send("tech", "PUT", `/${match.id}/referees/${referee.id}`, {
      name: "สมศักดิ์",
      role: "ผู้กำกับเส้น",
      sortOrder: 1,
    });
    expect((edited.body.match as Match).referees[0]?.role).toBe("ผู้กำกับเส้น");
    const removed = await send("tech", "DELETE", `/${match.id}/referees/${referee.id}`);
    expect((removed.body.match as Match).referees).toHaveLength(0);
    expect((await send("tech", "DELETE", `/${match.id}/referees/${referee.id}`)).res.status).toBe(
      404,
    );
    expect(
      (
        await send("sports-staff", "POST", `/${match.id}/referees`, {
          name: "x",
          role: "y",
          sortOrder: 0,
        })
      ).res.status,
    ).toBe(403);
  });

  test("one image is the cover, copied onto the match", async () => {
    const { match } = await seedMatch(t);
    const image = (url: string, isCover: boolean) => ({
      url,
      caption: null,
      isCover,
      sortOrder: 0,
    });
    const first = await send(
      "tech",
      "POST",
      `/${match.id}/images`,
      image("https://example.com/a.jpg", true),
    );
    expect(first.res.status).toBe(201);
    const second = await send(
      "tech",
      "POST",
      `/${match.id}/images`,
      image("https://example.com/b.jpg", true),
    );
    const after = second.body.match as Match;
    expect(after.coverImageUrl).toBe("https://example.com/b.jpg");
    expect(after.images.filter((i) => i.isCover).map((i) => i.url)).toEqual([
      "https://example.com/b.jpg",
    ]);

    const cover = defined(after.images.find((i) => i.isCover));
    const unset = await send(
      "tech",
      "PUT",
      `/${match.id}/images/${cover.id}`,
      image(cover.url, false),
    );
    expect((unset.body.match as Match).coverImageUrl).toBeNull();

    const other = defined(after.images.find((i) => !i.isCover));
    await send("tech", "PUT", `/${match.id}/images/${other.id}`, image(other.url, true));
    const removed = await send("tech", "DELETE", `/${match.id}/images/${other.id}`);
    expect((removed.body.match as Match).coverImageUrl).toBeNull();
    expect((removed.body.match as Match).images).toHaveLength(1);
    const bad = await send(
      "tech",
      "POST",
      `/${match.id}/images`,
      image("javascript:alert(1)", false),
    );
    expect(bad.res.status).toBe(400);
  });
});

describe("groups", () => {
  test("managers create, edit and delete groups; names and teams stay unique per stage", async () => {
    const { divisionId, teamIds } = await seedTeams("football", [
      "kmitl",
      "kmutt",
      "kmutnb-bangkok",
    ]);
    const group = (name: string, ids: (string | undefined)[], extra: object = {}) => ({
      divisionId,
      stageName: "รอบแบ่งกลุ่ม",
      name,
      teamIds: ids,
      sortOrder: 0,
      ...extra,
    });
    const created = await send("tech", "POST", "/groups", group("A", [teamIds[0], teamIds[1]]));
    expect(created.res.status).toBe(201);
    const id = created.body.id as string;
    expect((await send("tech", "POST", "/groups", group("A", [teamIds[2]]))).res.status).toBe(400);
    expect((await send("tech", "POST", "/groups", group("B", [teamIds[1]]))).res.status).toBe(400);

    const edited = await send(
      "tech",
      "PUT",
      `/groups/${id}`,
      group("A", [teamIds[2]], { version: 1 }),
    );
    expect(edited.res.status).toBe(200);
    expect(edited.body.items).toMatchObject([{ id, version: 2, teamIds: [teamIds[2]] }]);
    expect(
      (await send("tech", "PUT", `/groups/${id}`, group("A", [], { version: 1 }))).res.status,
    ).toBe(409);

    const listed = await send("sports-staff", "GET", `/groups?divisionId=${divisionId}`);
    expect((listed.body.items as unknown[]).length).toBe(1);
    expect((await send("tech", "DELETE", `/groups/${id}?version=2`)).res.status).toBe(200);
    expect(await t.db.select().from(competitionGroup)).toHaveLength(0);
  });
});

describe("placements", () => {
  test("managers set a division's final places as a whole list", async () => {
    const { divisionId, teamIds } = await seedTeams("football", [
      "kmitl",
      "kmutt",
      "kmutnb-bangkok",
    ]);
    const places = teamIds.map((teamId, index) => ({ teamId, place: index + 1 }));
    const saved = await send("tech", "PUT", "/placements", { divisionId, places });
    expect(saved.res.status).toBe(200);
    expect(saved.body.items).toHaveLength(3);
    const again = await send("tech", "PUT", "/placements", {
      divisionId,
      places: places.slice(0, 1),
    });
    expect(again.body.items).toEqual([{ teamId: teamIds[0], place: 1 }]);
    expect(
      (await send("sports-staff", "GET", `/placements/${divisionId}`)).body.items,
    ).toHaveLength(1);
    const twice = [places[0], places[0]];
    expect(
      (await send("tech", "PUT", "/placements", { divisionId, places: twice })).res.status,
    ).toBe(400);
  });
});

describe("knockout sources", () => {
  type SourcedSide = Side & { sourceMatchId: string | null; sourceResult: string | null };

  test("a side may wait on another match's winner; it is named after it", async () => {
    const { divisionId, teamIds } = await seedTeams("football", ["kmitl", "kmutt"]);
    const semi = await send(
      "tech",
      "POST",
      "/",
      matchBody(divisionId, [
        { teamId: teamIds[0], label: null },
        { teamId: teamIds[1], label: null },
      ]),
    );
    const semiId = (semi.body.match as Match).id;
    const setup = await send("tech", "GET", `/setup/${divisionId}`);
    expect((setup.body.matches as { id: string }[]).map((m) => m.id)).toEqual([semiId]);

    const final = await send(
      "tech",
      "POST",
      "/",
      matchBody(
        divisionId,
        [
          { teamId: null, label: null, source: { matchId: semiId, result: "winner" } },
          { teamId: null, label: "ผู้ชนะ M2" },
        ],
        { stageName: "ชิงชนะเลิศ", matchNo: 3 },
      ),
    );
    expect(final.res.status).toBe(201);
    const sides = (final.body.match as Match).participants as SourcedSide[];
    expect(sides.map((side) => [side.name, side.sourceMatchId, side.sourceResult])).toEqual([
      ["ผู้ชนะ M1", semiId, "winner"],
      ["ผู้ชนะ M2", null, null],
    ]);
    const list = await send("tech", "GET", `/?divisionId=${divisionId}`);
    const listed = (list.body.items as Match[]).find((m) => m.id !== semiId);
    expect((defined(listed).participants[0] as SourcedSide).sourceMatchId).toBe(semiId);
  });

  test("a source from another division, the match itself or a loop is refused", async () => {
    const { divisionId, teamIds } = await seedTeams("football", ["kmitl", "kmutt"]);
    const other = await seedMatch(t, "basketball-3x3-female");
    const twoTeams = [
      { teamId: teamIds[0], label: null },
      { teamId: teamIds[1], label: null },
    ];
    const foreign = await send(
      "tech",
      "POST",
      "/",
      matchBody(divisionId, [
        { teamId: null, label: null, source: { matchId: other.match.id, result: "winner" } },
        { teamId: teamIds[1], label: null },
      ]),
    );
    expect(foreign.res.status).toBe(400);

    const first = (await send("tech", "POST", "/", matchBody(divisionId, twoTeams))).body
      .match as Match;
    const second = (
      await send(
        "tech",
        "POST",
        "/",
        matchBody(
          divisionId,
          [
            { teamId: null, label: null, source: { matchId: first.id, result: "winner" } },
            { teamId: teamIds[1], label: null },
          ],
          { matchNo: 2 },
        ),
      )
    ).body.match as Match;

    const self = await send("tech", "PUT", `/${second.id}`, {
      ...matchBody(
        divisionId,
        [
          { teamId: null, label: null, source: { matchId: second.id, result: "winner" } },
          { teamId: teamIds[1], label: null },
        ],
        { matchNo: 2 },
      ),
      version: second.version,
    });
    expect(self.res.status).toBe(400);

    const loop = await send("tech", "PUT", `/${first.id}`, {
      ...matchBody(divisionId, [
        { teamId: null, label: null, source: { matchId: second.id, result: "loser" } },
        { teamId: teamIds[1], label: null },
      ]),
      version: first.version,
    });
    expect(loop.res.status).toBe(400);
    expect(loop.body.message).toBe("สายการแข่งวนกลับมาที่แมตช์นี้");
  });
});

describe("bracket builder", () => {
  type SourcedSide = Side & { sourceMatchId: string | null; sourceResult: string | null };
  type Listed = Match & { matchNo: number | null; stageName: string; roundNo: number | null };

  test("builds an empty bracket numbered after the division's last match", async () => {
    const { divisionId, teamIds } = await seedTeams("football", ["kmitl", "kmutt"]);
    await send(
      "tech",
      "POST",
      "/",
      matchBody(divisionId, [
        { teamId: teamIds[0], label: null },
        { teamId: teamIds[1], label: null },
      ]),
    );
    const res = await send("tech", "POST", "/bracket", { divisionId, teams: 4, thirdPlace: true });
    expect(res.res.status).toBe(201);
    expect(res.body.matchIds as string[]).toHaveLength(4);

    const list = await send("tech", "GET", `/?divisionId=${divisionId}`);
    const built = (list.body.items as Listed[])
      .filter((m) => (res.body.matchIds as string[]).includes(m.id))
      .toSorted((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0));
    expect(built.map((m) => [m.matchNo, m.stageName, m.friendly])).toEqual([
      [2, "รอบรองชนะเลิศ", true],
      [3, "รอบรองชนะเลิศ", true],
      [4, "ชิงชนะเลิศ", true],
      [5, "ชิงอันดับ 3", true],
    ]);
    const names = (m: Listed | undefined) => defined(m).participants.map((side) => side.name);
    expect(names(built[0])).toEqual(["ทีมที่ 1", "ทีมที่ 2"]);
    expect(names(built[2])).toEqual(["ผู้ชนะ M2", "ผู้ชนะ M3"]);
    expect(names(built[3])).toEqual(["ผู้แพ้ M2", "ผู้แพ้ M3"]);
    const finalSides = defined(built[2]).participants as SourcedSide[];
    expect(finalSides.map((side) => side.sourceMatchId)).toEqual([defined(built[0]).id, defined(built[1]).id]);
    expect((await audit()).filter((row) => row.action === "create")).toHaveLength(5);
  });

  test("sixteen teams fit in one write; staff who cannot manage matches are refused", async () => {
    const divisionId = await t.divisionId("football");
    const big = await send("tech", "POST", "/bracket", { divisionId, teams: 16, thirdPlace: true });
    expect(big.res.status).toBe(201);
    expect(big.body.matchIds as string[]).toHaveLength(16);
    const odd = await send("tech", "POST", "/bracket", { divisionId, teams: 6, thirdPlace: false });
    expect(odd.res.status).toBe(400);
    const athlete = await send("athlete", "POST", "/bracket", {
      divisionId,
      teams: 4,
      thirdPlace: false,
    });
    expect(athlete.res.status).toBe(403);
  });
});

describe("adding the match before a bracket side", () => {
  type SourcedSide = Side & { sourceMatchId: string | null; sourceResult: string | null };

  async function finalWithOpenSide() {
    const { divisionId, teamIds } = await seedTeams("football", ["kmitl", "kmutt", "kmutnb"]);
    const final = (
      await send(
        "tech",
        "POST",
        "/",
        matchBody(
          divisionId,
          [
            { teamId: teamIds[0], label: null },
            { teamId: null, label: "รอทีม" },
          ],
          { stageName: "ชิงชนะเลิศ", matchNo: 5 },
        ),
      )
    ).body.match as Match;
    return { divisionId, teamIds, final };
  }

  test("the new match's winner takes the open side in the same write", async () => {
    const { divisionId, teamIds, final } = await finalWithOpenSide();
    const res = await send("tech", "POST", "/", {
      ...matchBody(
        divisionId,
        [
          { teamId: teamIds[1], label: null },
          { teamId: teamIds[2], label: null },
        ],
        { stageName: "รอบรองชนะเลิศ", matchNo: 4 },
      ),
      feeds: { matchId: final.id, slot: 2, version: final.version },
    });
    expect(res.res.status).toBe(201);
    const semiId = (res.body.match as Match).id;
    const after = (await send("tech", "GET", `/${final.id}`)).body.match as Match;
    const side = after.participants[1] as SourcedSide;
    expect([side.name, side.sourceMatchId, side.sourceResult]).toEqual([
      "ผู้ชนะ M4",
      semiId,
      "winner",
    ]);
    expect(after.version).toBe(final.version + 1);
  });

  test("a side with a team, a stale read or a loop is refused and nothing is created", async () => {
    const { divisionId, teamIds, final } = await finalWithOpenSide();
    const body = (extra: object) => ({
      ...matchBody(divisionId, [
        { teamId: teamIds[1], label: null },
        { teamId: teamIds[2], label: null },
      ]),
      ...extra,
    });
    const taken = await send(
      "tech",
      "POST",
      "/",
      body({ feeds: { matchId: final.id, slot: 1, version: final.version } }),
    );
    expect(taken.res.status).toBe(400);
    expect(taken.body.message).toBe("ฝั่งนี้มีทีมอยู่แล้ว");

    const stale = await send(
      "tech",
      "POST",
      "/",
      body({ feeds: { matchId: final.id, slot: 2, version: final.version + 7 } }),
    );
    expect(stale.res.status).toBe(409);

    const loop = await send("tech", "POST", "/", {
      ...matchBody(divisionId, [
        { teamId: null, label: null, source: { matchId: final.id, result: "loser" } },
        { teamId: teamIds[2], label: null },
      ]),
      feeds: { matchId: final.id, slot: 2, version: final.version },
    });
    expect(loop.res.status).toBe(400);
    expect(loop.body.message).toBe("สายการแข่งวนกลับมาที่แมตช์นี้");

    const list = await send("tech", "GET", `/?divisionId=${divisionId}`);
    expect((list.body.items as Match[]).map((m) => m.id)).toEqual([final.id]);
  });
});

describe("races", () => {
  test("a status change loses to an edit that landed in between", async () => {
    const { match } = await seedMatch(t);
    t.hooks.beforeBatch = () => {
      t.sqlite.run("update competition_match set version = version + 1 where id = ?", [match.id]);
    };
    const { res } = await send("tech", "POST", `/${match.id}/status`, {
      status: "checkin",
      version: 1,
    });
    expect(res.status).toBe(409);
    const [row] = await t.db
      .select()
      .from(competitionMatch)
      .where(eq(competitionMatch.id, match.id));
    expect(defined(row).status).toBe("scheduled");
  });

  test("a manager who loses their seat mid-request writes nothing", async () => {
    const { match } = await seedMatch(t);
    t.hooks.beforeBatch = () => {
      t.sqlite.run("delete from leadership where user_id = 'sports-head'");
    };
    const { res } = await send("sports-head", "POST", `/${match.id}/referees`, {
      name: "สมศักดิ์",
      role: "ผู้ตัดสิน",
      sortOrder: 0,
    });
    expect(res.status).toBe(409);
    expect(await audit()).toHaveLength(0);
  });

  test("changing a side's team drops that side's lineup with it", async () => {
    const { divisionId, match, sides } = await seedMatch(t);
    const [other] = await t.db
      .insert(competitionTeam)
      .values({ divisionId, institution: "kmutnb-bangkok" })
      .returning();
    // Fake a lineup row on the away side by turning foreign keys off for the insert.
    t.sqlite.run("pragma foreign_keys = off");
    await t.db.insert(competitionLineup).values({
      participantId: defined(sides[1]).id,
      matchId: match.id,
      registrationId: "r-1",
      role: "starter",
    });
    t.sqlite.run("pragma foreign_keys = on");
    const edit = matchBody(
      divisionId,
      [
        { teamId: sides[0]?.teamId, label: null },
        { teamId: defined(other).id, label: null },
      ],
      { version: 1 },
    );
    expect((await send("tech", "PUT", `/${match.id}`, edit)).res.status).toBe(200);
    expect(await t.db.select().from(competitionLineup)).toHaveLength(0);
  });
});
