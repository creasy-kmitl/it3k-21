import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  ANNOUNCE_MODES,
  BREAKS_MAX,
  BREAK_MAX,
  DIVISION_MAX,
  DURATION_MAX,
  MATCH_STATUSES,
  type MatchBreak,
  RANKING_MAX,
  ROUND_MAX,
  SCORE_MAX,
  SCORING_MODES,
  SETS_TO_WIN_OPTIONS,
  SPORT_MAX,
  UNIVERSITIES,
  computeStandings,
  match,
  setsProblem,
  setsWon,
} from "@it3k/db/schema/match";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  type CurrentUserEnv,
  type RouteDeps,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { STALE_MESSAGE, epochMs, idParam, optionalText } from "../calendar/shared";

const sport = z.string().trim().min(1).max(SPORT_MAX);
const university = z.enum(UNIVERSITIES);
const score = z.number().int().min(0).max(SCORE_MAX).nullable();
const SAME_TEAMS = "A match needs two different universities";
const durationMinutes = z.number().int().min(1).max(DURATION_MAX);
const matchBreak = z.strictObject({
  atMinute: z.number().int().min(1).max(DURATION_MAX),
  minutes: z.number().int().min(1).max(BREAK_MAX),
});
const breaks = z.array(matchBreak).max(BREAKS_MAX);
const BAD_BREAKS = "Breaks must fall inside the match, in order, at different minutes";

/** Every break starts during play, and each one comes after the one before. */
function breaksFit(list: MatchBreak[], duration: number) {
  return list.every((pause, index) => {
    const previous = list[index - 1];
    return pause.atMinute < duration && (!previous || pause.atMinute > previous.atMinute);
  });
}

const ranking = z.array(university).max(RANKING_MAX);
const setsToWin = z.number().refine((value) => (SETS_TO_WIN_OPTIONS as readonly number[]).includes(value));
const matchSet = z.strictObject({
  a: z.number().int().min(0).max(SCORE_MAX),
  b: z.number().int().min(0).max(SCORE_MAX),
  done: z.boolean(),
});
const BAD_LIVE = "A match between two sides needs two different universities";
const BAD_AFTER = "A match announced after it ends has no sides, scores, length or breaks";
const BAD_SCORING = "This match is not reported that way";

const createInput = z
  .strictObject({
    sport,
    division: optionalText(DIVISION_MAX),
    round: optionalText(ROUND_MAX),
    announce: z.enum(ANNOUNCE_MODES).default("live"),
    scoring: z.enum(SCORING_MODES).default("points"),
    setsToWin: setsToWin.optional(),
    teamA: university.optional(),
    teamB: university.optional(),
    durationMinutes: durationMinutes.optional(),
    breaks: breaks.optional(),
    status: z.enum(MATCH_STATUSES).optional(),
    startsAt: epochMs,
  })
  .superRefine((input, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (input.announce === "after") {
      // Many teams: only a ranking, so nothing of a pair match may come with it.
      const extras =
        input.teamA ||
        input.teamB ||
        input.durationMinutes !== undefined ||
        input.breaks ||
        input.setsToWin !== undefined;
      if (extras || input.scoring !== "points") fail(BAD_AFTER);
      return;
    }
    if (!input.teamA || !input.teamB) return fail(BAD_LIVE);
    if (input.teamA === input.teamB) return fail(SAME_TEAMS);
    const timed = input.durationMinutes !== undefined || input.breaks !== undefined;
    if (input.scoring === "points") {
      if (input.setsToWin !== undefined) return fail(BAD_SCORING);
      if (input.durationMinutes === undefined) return fail("A scored match needs its length");
      if (!breaksFit(input.breaks ?? [], input.durationMinutes)) fail(BAD_BREAKS);
      return;
    }
    if (timed) return fail(BAD_SCORING);
    if (input.scoring === "sets" && input.setsToWin === undefined) fail("Sets need a series length");
    if (input.scoring === "after" && input.setsToWin !== undefined) fail(BAD_SCORING);
  });

const updateInput = z
  .strictObject({
    /** The version the client read; a newer one means someone else saved first. */
    version: z.number().int().min(1),
    sport: sport.optional(),
    division: optionalText(DIVISION_MAX),
    round: optionalText(ROUND_MAX),
    teamA: university.optional(),
    teamB: university.optional(),
    scoreA: score.optional(),
    scoreB: score.optional(),
    status: z.enum(MATCH_STATUSES).optional(),
    startsAt: epochMs.nullable().optional(),
    durationMinutes: durationMinutes.optional(),
    breaks: breaks.optional(),
    /** Each set's points, for a series of sets; the scores then follow from them. */
    sets: z.array(matchSet).max(Math.max(...SETS_TO_WIN_OPTIONS) * 2 - 1).optional(),
    /** The side that won a pair match reported after it ends. */
    winner: university.nullable().optional(),
    /** Who placed 1st, 2nd and 3rd, for a match announced after it ends. */
    ranking: ranking.nullable().optional(),
    /** Stop play for an emergency, or carry on. The server keeps the time, not the client. */
    paused: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).some((key) => key !== "version"), "Nothing to update");

/**
 * The pause columns after a request. Stopping records when; carrying on, or
 * leaving the live state, adds the stop to the total that pushes the finish back.
 */
function pauseChange(
  current: { pausedAt: Date | null; pausedMs: number },
  paused: boolean | undefined,
  status: (typeof MATCH_STATUSES)[number],
  now: Date,
) {
  const stillPaused = status === "live" && (paused ?? current.pausedAt !== null);
  if (stillPaused) return current.pausedAt ? {} : { pausedAt: now };
  if (!current.pausedAt) return {};
  return {
    pausedAt: null,
    pausedMs: current.pausedMs + Math.max(0, now.getTime() - current.pausedAt.getTime()),
  };
}

const NOT_LIVE = "Only a live match can be stopped";

const deleteQuery = z.strictObject({ version: z.coerce.number().int().min(1) });

function selectMatches(db: Database) {
  return db
    .select({ match, updatedByName: user.name })
    .from(match)
    .leftJoin(user, eq(user.id, match.updatedById));
}

type MatchRow = Awaited<ReturnType<ReturnType<typeof selectMatches>["all"]>>[number];

function toPublicMatch(row: typeof match.$inferSelect) {
  return {
    id: row.id,
    sport: row.sport,
    division: row.division,
    round: row.round,
    announce: row.announce,
    scoring: row.scoring,
    setsToWin: row.setsToWin,
    sets: row.sets ?? [],
    winner: row.winner,
    ranking: row.ranking ?? [],
    teamA: row.teamA,
    teamB: row.teamB,
    scoreA: row.scoreA,
    scoreB: row.scoreB,
    durationMinutes: row.durationMinutes,
    breaks: row.breaks ?? [],
    status: row.status,
    startsAt: row.startsAt ? row.startsAt.getTime() : null,
    pausedAt: row.pausedAt ? row.pausedAt.getTime() : null,
    pausedMs: row.pausedMs,
    updatedAt: row.updatedAt.getTime(),
  };
}

function toMatch(row: MatchRow) {
  return {
    ...toPublicMatch(row.match),
    version: row.match.version,
    updatedBy: row.match.updatedById
      ? { id: row.match.updatedById, name: row.updatedByName ?? "" }
      : null,
  };
}

export type Match = ReturnType<typeof toMatch>;

// Unscheduled matches last, then by start time and sport.
const matchOrder = [
  sql`${match.startsAt} is null`,
  asc(match.startsAt),
  asc(match.sport),
  asc(match.id),
];

async function findMatch(db: Database, matchId: string) {
  const [row] = await selectMatches(db).where(eq(match.id, matchId));
  return row ? toMatch(row) : null;
}

/** Staff record and correct scores. Every member may edit for now. */
export const createMatchRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)

    .get("/", async (c) => {
      const rows = await selectMatches(c.var.db).orderBy(...matchOrder);
      return c.json({ items: rows.map(toMatch) }, 200);
    })

    .post("/", validate("json", createInput), async (c) => {
      const { startsAt, ...input } = c.req.valid("json");
      const db = c.var.db;
      const matchId = crypto.randomUUID();
      // Only a match scored live starts at 0 : 0; the others have no score yet.
      const scored = input.announce === "live" && input.scoring !== "after";
      await db.insert(match).values({
        ...input,
        id: matchId,
        scoring: input.announce === "after" ? "after" : input.scoring,
        scoreA: scored ? 0 : null,
        scoreB: scored ? 0 : null,
        sets: input.scoring === "sets" && scored ? [{ a: 0, b: 0, done: false }] : null,
        breaks: input.breaks ?? [],
        startsAt: new Date(startsAt),
        updatedById: c.var.user.id,
      });
      const created = await findMatch(db, matchId);
      if (!created) throw new Error("Created match is missing");
      return c.json(created, 201);
    })

    .patch("/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
      const { id: matchId } = c.req.valid("param");
      const { version, startsAt, paused, ...fields } = c.req.valid("json");
      const db = c.var.db;
      const [current] = await db.select().from(match).where(eq(match.id, matchId));
      if (!current) return c.json({ message: "Match not found" }, 404);
      if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);
      const many = current.announce === "after";
      const points = !many && current.scoring === "points";
      const scoredFields = [fields.scoreA, fields.scoreB, fields.breaks, fields.durationMinutes];
      if (many) {
        const notRanked = [fields.teamA, fields.teamB, fields.sets, fields.winner, ...scoredFields];
        if (paused !== undefined || notRanked.some((value) => value !== undefined)) {
          return c.json({ message: BAD_AFTER }, 400);
        }
      } else if (fields.ranking !== undefined) {
        return c.json({ message: "Only a match announced after it ends has a ranking" }, 400);
      }
      if (!many && !points && (paused !== undefined || scoredFields.some((value) => value !== undefined))) {
        return c.json({ message: BAD_SCORING }, 400);
      }
      if (fields.sets !== undefined && (many || current.scoring !== "sets")) {
        return c.json({ message: BAD_SCORING }, 400);
      }
      if (fields.winner !== undefined && (many || current.scoring !== "after")) {
        return c.json({ message: BAD_SCORING }, 400);
      }
      const teamA = fields.teamA ?? current.teamA;
      const teamB = fields.teamB ?? current.teamB;
      if (!many && teamA === teamB) return c.json({ message: SAME_TEAMS }, 400);
      if (fields.winner && fields.winner !== teamA && fields.winner !== teamB) {
        return c.json({ message: "The winner must be one of the two sides" }, 400);
      }
      const wins = fields.sets ? setsWon(fields.sets) : null;
      const toWin = current.setsToWin ?? 0;
      if (fields.sets) {
        const bad = setsProblem(fields.sets, toWin);
        if (bad) return c.json({ message: bad }, 400);
      }
      // A new length or new breaks must still fit with whichever one is not being changed.
      const duration = fields.durationMinutes ?? current.durationMinutes;
      if (duration !== null && !breaksFit(fields.breaks ?? current.breaks ?? [], duration)) {
        return c.json({ message: BAD_BREAKS }, 400);
      }
      const now = new Date();
      const decided = wins !== null && (wins.a === toWin || wins.b === toWin);
      // Nothing starts by itself: a match is live only once staff say so.
      const status = fields.status ?? (decided ? "finished" : current.status);
      if (paused && status !== "live") return c.json({ message: NOT_LIVE }, 400);

      const updated = await db
        .update(match)
        .set({
          ...fields,
          // A series scores the sets won, so the standings and cards read it like any score.
          ...(wins ? { scoreA: wins.a, scoreB: wins.b } : {}),
          ...(startsAt === undefined
            ? {}
            : { startsAt: startsAt === null ? null : new Date(startsAt) }),
          // A match that went live by the clock is saved as live on its next write.
          status,
          ...pauseChange(current, paused, status, now),
          version: sql`${match.version} + 1`,
          updatedById: c.var.user.id,
          updatedAt: now,
        })
        // Checked again here, so a save that lands in between is not overwritten.
        .where(and(eq(match.id, matchId), eq(match.version, version)))
        .returning({ id: match.id });
      if (updated.length === 0) return c.json({ message: STALE_MESSAGE }, 409);
      const saved = await findMatch(db, matchId);
      if (!saved) return c.json({ message: "Match not found" }, 404);
      return c.json(saved, 200);
    })

    .delete("/:id", validate("param", idParam), validate("query", deleteQuery), async (c) => {
      const { id: matchId } = c.req.valid("param");
      const { version } = c.req.valid("query");
      const db = c.var.db;
      const [current] = await db.select().from(match).where(eq(match.id, matchId));
      if (!current) return c.json({ message: "Match not found" }, 404);
      if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);
      const deleted = await db
        .delete(match)
        .where(and(eq(match.id, matchId), eq(match.version, version)))
        .returning({ id: match.id });
      if (deleted.length === 0) return c.json({ message: STALE_MESSAGE }, 409);
      return c.json({ ok: true }, 200);
    });

export type MatchRoutes = ReturnType<typeof createMatchRoutes>;

/** The public scoreboard: no sign-in, read only. */
export const createPublicScoreRoutes = (deps: Pick<RouteDeps, "getDb">) =>
  new Hono().get("/", async (c) => {
    const rows = await deps
      .getDb()
      .select()
      .from(match)
      .orderBy(...matchOrder);
    const matches = rows.map(toPublicMatch);
    return c.json({ matches, standings: computeStandings(matches) }, 200);
  });

export type PublicScoreRoutes = ReturnType<typeof createPublicScoreRoutes>;
