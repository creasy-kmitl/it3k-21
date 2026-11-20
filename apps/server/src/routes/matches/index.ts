import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  BREAKS_MAX,
  BREAK_MAX,
  DURATION_MAX,
  MATCH_STATUSES,
  type MatchBreak,
  ROUND_MAX,
  SCORE_MAX,
  SPORT_MAX,
  UNIVERSITIES,
  computeStandings,
  currentStatus,
  match,
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

const createInput = z
  .strictObject({
    sport,
    round: optionalText(ROUND_MAX),
    teamA: university,
    teamB: university,
    durationMinutes,
    breaks: breaks.optional(),
    status: z.enum(MATCH_STATUSES).optional(),
    startsAt: epochMs,
  })
  .refine((input) => input.teamA !== input.teamB, SAME_TEAMS)
  .refine((input) => breaksFit(input.breaks ?? [], input.durationMinutes), BAD_BREAKS);

const updateInput = z
  .strictObject({
    /** The version the client read; a newer one means someone else saved first. */
    version: z.number().int().min(1),
    sport: sport.optional(),
    round: optionalText(ROUND_MAX),
    teamA: university.optional(),
    teamB: university.optional(),
    scoreA: score.optional(),
    scoreB: score.optional(),
    status: z.enum(MATCH_STATUSES).optional(),
    startsAt: epochMs.nullable().optional(),
    durationMinutes: durationMinutes.optional(),
    breaks: breaks.optional(),
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
    round: row.round,
    teamA: row.teamA,
    teamB: row.teamB,
    scoreA: row.scoreA,
    scoreB: row.scoreB,
    durationMinutes: row.durationMinutes,
    breaks: row.breaks ?? [],
    status: currentStatus(row.status, row.startsAt?.getTime() ?? null, Date.now()),
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
      await db.insert(match).values({
        ...input,
        id: matchId,
        scoreA: 0,
        scoreB: 0,
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
      if ((fields.teamA ?? current.teamA) === (fields.teamB ?? current.teamB)) {
        return c.json({ message: SAME_TEAMS }, 400);
      }
      // A new length or new breaks must still fit with whichever one is not being changed.
      const duration = fields.durationMinutes ?? current.durationMinutes;
      if (duration !== null && !breaksFit(fields.breaks ?? current.breaks ?? [], duration)) {
        return c.json({ message: BAD_BREAKS }, 400);
      }
      const now = new Date();
      const startsAtMs = current.startsAt?.getTime() ?? null;
      const status = fields.status ?? currentStatus(current.status, startsAtMs, now.getTime());
      if (paused && status !== "live") return c.json({ message: NOT_LIVE }, 400);

      const updated = await db
        .update(match)
        .set({
          ...fields,
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
