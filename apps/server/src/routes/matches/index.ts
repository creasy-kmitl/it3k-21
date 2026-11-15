import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  MATCH_STATUSES,
  ROUND_MAX,
  SCORE_MAX,
  SPORT_MAX,
  UNIVERSITIES,
  computeStandings,
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

const createInput = z
  .strictObject({
    sport,
    round: optionalText(ROUND_MAX),
    teamA: university,
    teamB: university,
    scoreA: score.optional(),
    scoreB: score.optional(),
    status: z.enum(MATCH_STATUSES).optional(),
    startsAt: epochMs.nullable().optional(),
  })
  .refine((input) => input.teamA !== input.teamB, SAME_TEAMS);

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
  })
  .refine((input) => Object.keys(input).some((key) => key !== "version"), "Nothing to update");

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
    status: row.status,
    startsAt: row.startsAt ? row.startsAt.getTime() : null,
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
        startsAt: startsAt == null ? null : new Date(startsAt),
        updatedById: c.var.user.id,
      });
      const created = await findMatch(db, matchId);
      if (!created) throw new Error("Created match is missing");
      return c.json(created, 201);
    })

    .patch("/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
      const { id: matchId } = c.req.valid("param");
      const { version, startsAt, ...fields } = c.req.valid("json");
      const db = c.var.db;
      const [current] = await db.select().from(match).where(eq(match.id, matchId));
      if (!current) return c.json({ message: "Match not found" }, 404);
      if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);
      if ((fields.teamA ?? current.teamA) === (fields.teamB ?? current.teamB)) {
        return c.json({ message: SAME_TEAMS }, 400);
      }

      const updated = await db
        .update(match)
        .set({
          ...fields,
          ...(startsAt === undefined
            ? {}
            : { startsAt: startsAt === null ? null : new Date(startsAt) }),
          version: sql`${match.version} + 1`,
          updatedById: c.var.user.id,
          updatedAt: new Date(),
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
