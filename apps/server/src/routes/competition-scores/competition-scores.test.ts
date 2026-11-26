import { beforeEach, describe, expect, test } from "bun:test";
import type { ScoreEventPayload } from "@it3k/db/competition-rules";
import {
  competitionChange,
  competitionLineup,
  competitionMatch,
  competitionMatchParticipant,
  competitionScoreEvent,
  competitionTeamMember,
  sportRegistration,
} from "@it3k/db/schema/index";
import { and, asc, eq } from "drizzle-orm";

import { loadMatch } from "../../competition/access";
import { seedMatch } from "../../competition/testing";
import { createTestContext, defined, readJson } from "../../testing";
import { createCompetitionScoreRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createCompetitionScoreRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createCompetitionScoreRoutes(t.deps);
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("sports-staff", { department: "กีฬา", institution: "kmitl" });
  await t.seedUser("reg-kmutt", { department: "ทะเบียน", institution: "kmutt" });
  await t.seedUser("athlete", { role: "athlete" });
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

let counter = 0;
const uuid = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};
const event = (payload: ScoreEventPayload, id = uuid()) => ({ id, clientAt: Date.now(), payload });
const goal = (participantId: string, points = 1) =>
  event({ type: "score", participantId, points, registrationId: null });

type Board = {
  match: { status: string; version: number; scoreSeq: number; startedAt: number | null };
  sides: {
    id: string;
    name: string;
    score: number | null;
    outcome: string | null;
    rank: number | null;
    players: unknown[];
  }[];
  events: { id: string; seq: number; voided: boolean }[];
  state: { decided: boolean; period: number; phase: string };
  canScore: boolean;
};

const board = (body: Record<string, unknown>) => body as unknown as Board;

describe("reading", () => {
  test("competition readers get the match, its sides, events and state", async () => {
    const { match, sides } = await seedMatch(t);
    const { res, body } = await send("sports-staff", "GET", `/${match.id}`);
    expect(res.status).toBe(200);
    const read = board(body);
    expect(read.sides.map((s) => s.name)).toEqual(["สจล.", "มจธ."]);
    expect(read.sides.map((s) => s.id)).toEqual(sides.map((s) => s.id));
    expect(read.events).toEqual([]);
    expect(read.state).toMatchObject({ decided: false, period: 1, phase: "regular" });
    expect(read.canScore).toBe(true);
    expect((body.scoring as { engine: string }).engine).toBe("points");
    expect((await send("sports-staff", "GET", "/nope")).res.status).toBe(404);
  });

  test("athletes and other institutions' registration staff are refused", async () => {
    const { match } = await seedMatch(t);
    for (const who of ["athlete", "reg-kmutt"]) {
      expect((await send(who, "GET", `/${match.id}`)).res.status).toBe(403);
    }
  });

  test("the shirt-number picker gets the lineup, else the whole team", async () => {
    const { match, sides } = await seedMatch(t);
    const [home, away] = sides.map((s) => defined(s));
    const divisionId = await t.divisionId("football");
    const players: [string, string, number][] = [
      ["p1", defined(home?.teamId), 10],
      ["p2", defined(home?.teamId), 7],
      ["p3", defined(away?.teamId), 9],
    ];
    for (const [id, teamId, shirtNumber] of players) {
      await t.seedParticipant(id);
      const [reg] = await t.db
        .insert(sportRegistration)
        .values({ userId: id, divisionId, institution: "kmitl", status: "approved", shirtNumber })
        .returning();
      await t.db.insert(competitionTeamMember).values({
        teamId,
        registrationId: defined(reg).id,
        userId: id,
        displayName: `ชื่อ ${id}`,
      });
    }
    const [p1] = await t.db
      .select({ id: sportRegistration.id })
      .from(sportRegistration)
      .where(eq(sportRegistration.userId, "p1"));
    await t.db.insert(competitionLineup).values({
      participantId: defined(home).id,
      matchId: match.id,
      registrationId: defined(p1).id,
      role: "starter",
    });
    const read = board((await send("tech", "GET", `/${match.id}`)).body);
    expect(read.sides[0]?.players).toEqual([
      { registrationId: defined(p1).id, displayName: "ชื่อ p1", shirtNumber: 10, role: "starter" },
    ]);
    expect(read.sides[1]?.players).toMatchObject([
      { displayName: "ชื่อ p3", shirtNumber: 9, role: null },
    ]);
  });
});

describe("score events", () => {
  test("events are stored in order, start the match and cache each side's score", async () => {
    const { match, sides } = await seedMatch(t);
    const [home, away] = sides.map((s) => s.id) as [string, string];
    const { res, body } = await send("sports-staff", "POST", `/${match.id}/events`, {
      events: [goal(defined(home)), goal(defined(away)), goal(defined(home))],
    });
    expect(res.status).toBe(200);
    const read = board(body);
    expect(read.match.status).toBe("live");
    expect(read.match.startedAt).not.toBeNull();
    expect(read.match.scoreSeq).toBe(3);
    expect(read.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(read.sides.map((s) => s.score)).toEqual([2, 1]);

    const loaded = defined(await loadMatch(t.db, match.id));
    expect(loaded.participants.map((p) => p.score)).toEqual([2, 1]);
    expect(loaded.liveState).toMatchObject({ period: 1, decided: false });
    const log = await t.db.select().from(competitionChange);
    expect(log.map((row) => row.action)).toEqual(["start"]);
    const [stored] = await t.db
      .select()
      .from(competitionScoreEvent)
      .orderBy(asc(competitionScoreEvent.seq));
    expect(stored).toMatchObject({ type: "score", participantId: home, createdBy: "sports-staff" });
  });

  test("sending the same ids again changes nothing", async () => {
    const { match, sides } = await seedMatch(t);
    const home = defined(sides[0]).id;
    const batch = [goal(home), goal(home)];
    await send("tech", "POST", `/${match.id}/events`, { events: batch });
    const again = await send("tech", "POST", `/${match.id}/events`, {
      events: [...batch, goal(home)],
    });
    expect(again.res.status).toBe(200);
    const read = board(again.body);
    expect(read.sides[0]?.score).toBe(3);
    expect(read.match.scoreSeq).toBe(3);
    // A batch holding only known ids is a no-op, even repeated within itself.
    const replay = await send("tech", "POST", `/${match.id}/events`, {
      events: [batch[0], batch[0]],
    });
    expect(board(replay.body).match.scoreSeq).toBe(3);
  });

  test("an id used by another match is refused", async () => {
    const first = await seedMatch(t);
    const other = await seedMatch(t, "basketball-5x5-male");
    const shared = goal(defined(first.sides[0]).id);
    await send("tech", "POST", `/${first.match.id}/events`, { events: [shared] });
    const { res } = await send("tech", "POST", `/${other.match.id}/events`, {
      events: [
        { ...shared, payload: { ...shared.payload, participantId: defined(other.sides[0]).id } },
      ],
    });
    expect(res.status).toBe(409);
  });

  test("events that do not fit the match's settings are refused", async () => {
    const { match, sides } = await seedMatch(t);
    const home = defined(sides[0]).id;
    const cases = [
      event({ type: "game", participantId: home }),
      goal("someone-else"),
      goal(home, 3),
    ];
    for (const bad of cases) {
      const { res, body } = await send("tech", "POST", `/${match.id}/events`, { events: [bad] });
      expect(res.status).toBe(400);
      expect(body.eventId).toBe(bad.id);
    }
    expect((await t.db.select().from(competitionScoreEvent)).length).toBe(0);
  });

  test("a scorer writing at the same time gets the next seq, not an error", async () => {
    const { match, sides } = await seedMatch(t);
    const [home, away] = sides.map((s) => s.id) as [string, string];
    let raced = false;
    t.hooks.beforeBatch = () => {
      if (raced) return;
      raced = true;
      // Another phone's goal lands between this request's read and its batch.
      t.sqlite.run(
        `insert into competition_score_event (id, match_id, seq, type, participant_id, payload)
         values ('other', '${match.id}', 1, 'score', '${away}', '${JSON.stringify({ type: "score", participantId: away, points: 1, registrationId: null })}')`,
      );
      t.sqlite.run(`update competition_match set score_seq = 1 where id = '${match.id}'`);
    };
    const { res, body } = await send("tech", "POST", `/${match.id}/events`, {
      events: [goal(home)],
    });
    expect(res.status).toBe(200);
    const read = board(body);
    expect(read.events.map((e) => [e.id === "other", e.seq])).toEqual([
      [true, 1],
      [false, 2],
    ]);
    expect(read.sides.map((s) => s.score)).toEqual([1, 1]);
  });

  test("only scorers may add events, and only as JSON", async () => {
    const { match, sides } = await seedMatch(t);
    const body = { events: [goal(defined(sides[0]).id)] };
    expect((await send("athlete", "POST", `/${match.id}/events`, body)).res.status).toBe(403);
    const res = await app.request(`/${match.id}/events`, {
      ...t.as("tech", { method: "POST" }),
      body: JSON.stringify(body),
    });
    expect(res.status).not.toBe(200);
  });
});

describe("undo", () => {
  test("voiding an event replays the score without it; voiding again changes nothing", async () => {
    const { match, sides } = await seedMatch(t);
    const home = defined(sides[0]).id;
    const first = goal(home);
    const second = goal(home);
    await send("tech", "POST", `/${match.id}/events`, { events: [first, second] });
    const undo = await send("tech", "POST", `/${match.id}/events/${second.id}/void`, {});
    expect(undo.res.status).toBe(200);
    const read = board(undo.body);
    expect(read.sides[0]?.score).toBe(1);
    expect(read.events.find((e) => e.id === second.id)?.voided).toBe(true);
    const again = await send("tech", "POST", `/${match.id}/events/${second.id}/void`, {});
    expect(board(again.body).sides[0]?.score).toBe(1);
    const [stored] = await t.db
      .select()
      .from(competitionScoreEvent)
      .where(eq(competitionScoreEvent.id, second.id));
    expect(stored?.voidedBy).toBe("tech");
    expect((await send("tech", "POST", `/${match.id}/events/nope/void`, {})).res.status).toBe(404);
  });
});

describe("start, finish and results", () => {
  test("start marks the match live once", async () => {
    const { match } = await seedMatch(t);
    const started = await send("tech", "POST", `/${match.id}/start`, {});
    expect(board(started.body).match.status).toBe("live");
    const again = await send("tech", "POST", `/${match.id}/start`, {});
    expect(again.res.status).toBe(200);
    const log = await t.db.select().from(competitionChange);
    expect(log.map((row) => row.action)).toEqual(["start"]);
  });

  test("finishing needs a decided match unless forced", async () => {
    const { match, sides } = await seedMatch(t, "basketball-5x5-male");
    const [home, away] = sides.map((s) => s.id) as [string, string];
    let read = board(
      (
        await send("tech", "POST", `/${match.id}/events`, {
          events: [goal(home, 2), goal(away, 2)],
        })
      ).body,
    );
    const refused = await send("tech", "POST", `/${match.id}/finish`, {
      force: false,
      version: read.match.version,
    });
    expect(refused.res.status).toBe(409);

    read = board(
      (
        await send("tech", "POST", `/${match.id}/events`, {
          events: [goal(home, 3), event({ type: "period", period: 5 })],
        })
      ).body,
    );
    expect(read.state.decided).toBe(true);
    const stale = await send("tech", "POST", `/${match.id}/finish`, {
      force: false,
      version: read.match.version - 1,
    });
    expect(stale.res.status).toBe(409);
    const done = await send("tech", "POST", `/${match.id}/finish`, {
      force: false,
      version: read.match.version,
    });
    expect(done.res.status).toBe(200);
    read = board(done.body);
    expect(read.match.status).toBe("finished");
    expect(read.sides.map((s) => [s.score, s.rank, s.outcome])).toEqual([
      [5, 1, "win"],
      [2, 2, "loss"],
    ]);
    const [row] = await t.db
      .select()
      .from(competitionMatch)
      .where(eq(competitionMatch.id, match.id));
    expect(row?.outcome).toBe("played");

    // A finished match takes no more events.
    const late = await send("tech", "POST", `/${match.id}/events`, { events: [goal(away)] });
    expect(late.res.status).toBe(409);
  });

  test("staff may force a finish: scores rank the sides", async () => {
    const { match, sides } = await seedMatch(t, "basketball-5x5-male");
    const away = defined(sides[1]).id;
    const read = board(
      (await send("tech", "POST", `/${match.id}/events`, { events: [goal(away, 3)] })).body,
    );
    const done = await send("tech", "POST", `/${match.id}/finish`, {
      force: true,
      version: read.match.version,
    });
    expect(board(done.body).sides.map((s) => [s.rank, s.outcome])).toEqual([
      [2, "loss"],
      [1, "win"],
    ]);
    const log = await t.db.select().from(competitionChange);
    expect(log.at(-1)?.changes).toMatchObject({ force: true });
  });

  test("a walkover is recorded without play, for every side", async () => {
    const { match, sides } = await seedMatch(t);
    const [home, away] = sides.map((s) => s.id) as [string, string];
    const missing = await send("tech", "POST", `/${match.id}/result`, {
      outcome: "walkover",
      ranks: [{ participantId: home, rank: 1, outcome: "walkover_win" }],
      version: match.version,
    });
    expect(missing.res.status).toBe(400);
    const done = await send("tech", "POST", `/${match.id}/result`, {
      outcome: "walkover",
      ranks: [
        { participantId: home, rank: 1, outcome: "walkover_win" },
        { participantId: away, rank: 2, outcome: "forfeit" },
      ],
      version: match.version,
    });
    expect(done.res.status).toBe(200);
    const read = board(done.body);
    expect(read.match.status).toBe("finished");
    expect(read.sides.map((s) => s.outcome)).toEqual(["walkover_win", "forfeit"]);
    const [row] = await t.db
      .select()
      .from(competitionMatch)
      .where(eq(competitionMatch.id, match.id));
    expect(row?.outcome).toBe("walkover");
  });

  test("a sub-match's result counts as a game of its parent series", async () => {
    const { match: parent, sides, divisionId } = await seedMatch(t, "table-tennis-doubles-male");
    await t.db
      .update(competitionMatch)
      .set({
        scoringConfig: { engine: "series", gamesToWin: 3, gameLabel: "คู่", fromSubMatches: true },
      })
      .where(eq(competitionMatch.id, parent.id));
    const [sub] = await t.db
      .insert(competitionMatch)
      .values({ divisionId, stageName: "รอบชิง", parentMatchId: parent.id, subOrder: 1 })
      .returning();
    const subSides = await t.db
      .insert(competitionMatchParticipant)
      .values(
        sides.map((side) => ({ matchId: defined(sub).id, teamId: side.teamId, slot: side.slot })),
      )
      .returning();
    const [subHome, subAway] = subSides.map((s) => s.id);
    const done = await send("tech", "POST", `/${defined(sub).id}/result`, {
      outcome: "played",
      ranks: [
        { participantId: subHome, rank: 2, outcome: "loss" },
        { participantId: subAway, rank: 1, outcome: "win" },
      ],
      version: defined(sub).version,
    });
    expect(done.res.status).toBe(200);
    const loaded = defined(await loadMatch(t.db, parent.id));
    expect(loaded.participants.map((p) => p.score)).toEqual([0, 1]);
    const read = board((await send("tech", "GET", `/${parent.id}`)).body);
    expect(read.state).toMatchObject({ period: 2, decided: false });
  });
});

describe("knockout advance", () => {
  /** A semi-final (KMITL v KMUTT) feeding the final's first side and the third-place match. */
  async function bracket() {
    const { match: semi, sides, divisionId } = await seedMatch(t);
    const [final, third] = await t.db
      .insert(competitionMatch)
      .values([
        { divisionId, stageName: "ชิงชนะเลิศ" },
        { divisionId, stageName: "ชิงที่ 3" },
      ])
      .returning();
    const fed = await t.db
      .insert(competitionMatchParticipant)
      .values([
        {
          matchId: defined(final).id,
          slot: 1,
          label: "ผู้ชนะ M1",
          sourceMatchId: semi.id,
          sourceResult: "winner" as const,
        },
        { matchId: defined(final).id, slot: 2, label: "ผู้ชนะ M2" },
        {
          matchId: defined(third).id,
          slot: 1,
          label: "ผู้แพ้ M1",
          sourceMatchId: semi.id,
          sourceResult: "loser" as const,
        },
      ])
      .returning();
    const [home, away] = sides as [(typeof sides)[number], (typeof sides)[number]];
    return { semi, home, away, final: defined(final), third: defined(third), fed };
  }

  const teamOf = async (participantId: string) => {
    const [row] = await t.db
      .select({ teamId: competitionMatchParticipant.teamId })
      .from(competitionMatchParticipant)
      .where(eq(competitionMatchParticipant.id, participantId));
    return row?.teamId ?? null;
  };
  const versionOf = async (matchId: string) => {
    const [row] = await t.db
      .select({ version: competitionMatch.version })
      .from(competitionMatch)
      .where(eq(competitionMatch.id, matchId));
    return row?.version;
  };

  const walkover = (matchId: string, version: number, winner: string, loser: string) =>
    send("tech", "POST", `/${matchId}/result`, {
      outcome: "walkover",
      ranks: [
        { participantId: winner, rank: 1, outcome: "walkover_win" },
        { participantId: loser, rank: 2, outcome: "forfeit" },
      ],
      version,
    });

  test("the winner and loser move into the sides waiting on the match", async () => {
    const { semi, home, away, final, fed } = await bracket();
    const [finalSide, , thirdSide] = fed as [(typeof fed)[number], unknown, (typeof fed)[number]];
    const done = await walkover(semi.id, semi.version, home.id, away.id);
    expect(done.res.status).toBe(200);
    expect(await teamOf(finalSide.id)).toBe(home.teamId);
    expect(await teamOf(thirdSide.id)).toBe(away.teamId);
    // Open edit forms on the final must reload.
    expect(await versionOf(final.id)).toBe(final.version + 1);
  });

  test("a corrected result moves the right teams, until the next match starts", async () => {
    const { semi, home, away, final, fed } = await bracket();
    const [finalSide, , thirdSide] = fed as [(typeof fed)[number], unknown, (typeof fed)[number]];
    await walkover(semi.id, semi.version, home.id, away.id);
    const corrected = await walkover(semi.id, defined(await versionOf(semi.id)), away.id, home.id);
    expect(corrected.res.status).toBe(200);
    expect(await teamOf(finalSide.id)).toBe(away.teamId);
    expect(await teamOf(thirdSide.id)).toBe(home.teamId);

    await t.db
      .update(competitionMatch)
      .set({ status: "live", scoreSeq: 1 })
      .where(eq(competitionMatch.id, final.id));
    await walkover(semi.id, defined(await versionOf(semi.id)), home.id, away.id);
    // The final has started and keeps its team; the third-place match has not.
    expect(await teamOf(finalSide.id)).toBe(away.teamId);
    expect(await teamOf(thirdSide.id)).toBe(away.teamId);
  });

  test("no single winner moves nobody, and a team never plays itself", async () => {
    const { semi, home, away, final, fed } = await bracket();
    const [finalSide] = fed as [(typeof fed)[number]];
    const drawn = await send("tech", "POST", `/${semi.id}/result`, {
      outcome: "played",
      ranks: [
        { participantId: home.id, rank: 1, outcome: "draw" },
        { participantId: away.id, rank: 1, outcome: "draw" },
      ],
      version: semi.version,
    });
    expect(drawn.res.status).toBe(200);
    expect(await teamOf(finalSide.id)).toBeNull();

    // The final's other side already holds KMITL: the winner cannot be put in twice.
    await t.db
      .update(competitionMatchParticipant)
      .set({ teamId: home.teamId })
      .where(
        and(
          eq(competitionMatchParticipant.matchId, final.id),
          eq(competitionMatchParticipant.slot, 2),
        ),
      );
    const won = await walkover(semi.id, defined(await versionOf(semi.id)), home.id, away.id);
    expect(won.res.status).toBe(200);
    expect(await teamOf(finalSide.id)).toBeNull();
  });
});
