// Matches, groups, schedules (by hand, or round robin with a preview),
// referees, images and final placements. Everyone who reads competitions sees
// matches; match managers change them. Results and scores are the scoring
// routes' (competition/results.ts); nothing here writes a score.
import type { Database } from "@it3k/db";
import {
  MIN_TEAMS_FOR_MEDALS,
  type MatchInput,
  matchImageInput,
  matchInput,
  matchStatusInput,
  refereeInput,
} from "@it3k/db/competition-rules";
import {
  competitionGroup,
  competitionMatch,
  competitionMatchImage,
  competitionMatchParticipant,
  competitionMatchReferee,
} from "@it3k/db/schema/index";
import { and, count, eq, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { matchAsRead } from "../../competition/access";
import { logCompetitionChange } from "../../competition/audit";
import {
  type CurrentUserEnv,
  type RouteDeps,
  constraintError,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { allowSport } from "../../middleware/sport-permission";
import { validate } from "../../middleware/validation";
import { canSport } from "../../policies/sports";
import { createGroupRoutes, listGroups } from "./groups";
import { createPlacementRoutes } from "./placements";
import { listMatches, listQuery, matchDetail } from "./read";
import { createScheduleRoutes } from "./schedule";
import {
  MESSAGES,
  checkTeams,
  checkVenues,
  divisionParam,
  divisionTeams,
  guards,
  idParam,
  loadDivision,
  versionQuery,
} from "./shared";

const version = z.number().int().min(0);
const matchUpdateInput = matchInput.extend({ version });
const placeholderTeamInput = z.strictObject({ teamId: z.string().min(1), version });
const participantParam = idParam.extend({ participantId: z.string().min(1) });
const refereeParam = idParam.extend({ refereeId: z.string().min(1) });
const imageParam = idParam.extend({ imageId: z.string().min(1) });

const STARTED = "แมตช์เริ่มแล้ว เปลี่ยนผู้แข่งหรือลบไม่ได้";
const FINISHED = "แมตช์จบแล้ว เปลี่ยนสถานะไม่ได้";
const NOT_PLACEHOLDER = "ฝั่งนี้มีทีมอยู่แล้ว";
const TEAM_ALREADY_PLAYING = "ทีมนี้อยู่ในแมตช์นี้แล้ว";
const PARTICIPANT_NOT_FOUND = "ไม่พบฝั่งนี้ในแมตช์";
const REFEREE_NOT_FOUND = "ไม่พบกรรมการคนนี้";
const IMAGE_NOT_FOUND = "ไม่พบรูปนี้";
const COVER_TAKEN = "แมตช์นี้มีรูปปกแล้ว โหลดใหม่แล้วลองอีกครั้ง";

type MatchRow = typeof competitionMatch.$inferSelect;

async function findMatch(db: Database, id: string): Promise<MatchRow | undefined> {
  const [row] = await db.select().from(competitionMatch).where(eq(competitionMatch.id, id));
  return row;
}

const hasStarted = (match: Pick<MatchRow, "status" | "scoreSeq">) =>
  match.scoreSeq > 0 || match.status === "live" || match.status === "finished";

/** Why a match cannot be saved as asked, or null. Sub-matches stay in their parent's division. */
async function checkMatch(db: Database, input: MatchInput) {
  const teamIds = input.participants.flatMap((p) => (p.teamId ? [p.teamId] : []));
  const teamProblem = await checkTeams(db, input.divisionId, teamIds);
  if (teamProblem) return teamProblem;
  const venueProblem = await checkVenues(db, [input.venueId]);
  if (venueProblem) return venueProblem;
  if (input.groupId) {
    const [group] = await db
      .select({ divisionId: competitionGroup.divisionId })
      .from(competitionGroup)
      .where(eq(competitionGroup.id, input.groupId));
    if (group?.divisionId !== input.divisionId) return MESSAGES.groupNotFound;
  }
  if (input.parentMatchId) {
    const parent = await findMatch(db, input.parentMatchId);
    if (!parent || parent.divisionId !== input.divisionId) return "ไม่พบแมตช์หลัก";
    if (parent.parentMatchId) return "แมตช์ย่อยมีแมตช์ย่อยซ้อนไม่ได้";
  }
  return null;
}

function staleOr(error: unknown) {
  const kind = constraintError(error);
  if (kind === "stale" || kind === "foreign-key") return MESSAGES.stale;
  if (kind === "unique") return TEAM_ALREADY_PLAYING;
  throw error;
}

async function detailOrThrow(db: Database, id: string) {
  const match = await matchDetail(db, id);
  if (!match) throw new Error(`Match ${id} vanished after a write`);
  return match;
}

export const createCompetitionMatchRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(allowSport("competition.read"))

    .route("/groups", createGroupRoutes())
    .route("/placements", createPlacementRoutes())
    .route("/schedule", createScheduleRoutes())

    .get("/", validate("query", listQuery), async (c) => {
      const items = await listMatches(c.var.db, c.req.valid("query"));
      return c.json(
        {
          items,
          canManage: canSport(c.var.user, "matches.manage"),
          canScore: canSport(c.var.user, "matches.score"),
        },
        200,
      );
    })

    // What the create form and the schedule builder need for one division.
    .get("/setup/:divisionId", validate("param", divisionParam), async (c) => {
      const db = c.var.db;
      const { divisionId } = c.req.valid("param");
      const division = await loadDivision(db, divisionId);
      if (!division) return c.json({ message: MESSAGES.divisionNotFound }, 404);
      const teams = await divisionTeams(db, divisionId);
      const [last] = await db
        .select({ matchNo: max(competitionMatch.matchNo) })
        .from(competitionMatch)
        .where(eq(competitionMatch.divisionId, divisionId));
      return c.json(
        {
          division,
          teams,
          groups: await listGroups(db, divisionId),
          friendlyByDefault: teams.length < MIN_TEAMS_FOR_MEDALS,
          nextMatchNo: (last?.matchNo ?? 0) + 1,
        },
        200,
      );
    })

    .get("/:id", validate("param", idParam), async (c) => {
      const match = await matchDetail(c.var.db, c.req.valid("param").id);
      if (!match) return c.json({ message: MESSAGES.matchNotFound }, 404);
      return c.json(
        {
          match,
          canManage: canSport(c.var.user, "matches.manage"),
          canScore: canSport(c.var.user, "matches.score"),
          canCheckin: canSport(c.var.user, "matches.checkin"),
        },
        200,
      );
    })

    .post("/", allowSport("matches.manage"), validate("json", matchInput), async (c) => {
      const db = c.var.db;
      const input = c.req.valid("json");
      if (!(await loadDivision(db, input.divisionId))) {
        return c.json({ message: MESSAGES.divisionNotFound }, 404);
      }
      const problem = await checkMatch(db, input);
      if (problem) return c.json({ message: problem }, 400);
      let subOrder: number | null = null;
      if (input.parentMatchId) {
        const [last] = await db
          .select({ subOrder: max(competitionMatch.subOrder) })
          .from(competitionMatch)
          .where(eq(competitionMatch.parentMatchId, input.parentMatchId));
        subOrder = (last?.subOrder ?? 0) + 1;
      }
      const id = crypto.randomUUID();
      const { participants, startAt, ...fields } = input;
      const teamIds = participants.flatMap((p) => (p.teamId ? [p.teamId] : []));
      try {
        await db.batch([
          ...guards(db, c.var.user, { divisionId: input.divisionId, teamIds }),
          db.insert(competitionMatch).values({
            id,
            ...fields,
            subOrder,
            startAt: startAt === null ? null : new Date(startAt),
            createdBy: c.var.user.id,
          }),
          db.insert(competitionMatchParticipant).values(
            participants.map((p, index) => ({
              matchId: id,
              teamId: p.teamId,
              label: p.label || null,
              slot: index + 1,
            })),
          ),
          logCompetitionChange(db, c.var.user, "match", id, "create", input),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        // Another sub-match took this number at the same moment.
        if (kind === "unique" && input.parentMatchId) {
          return c.json({ message: MESSAGES.stale }, 409);
        }
        return c.json({ message: staleOr(error) }, 409);
      }
      return c.json({ match: await detailOrThrow(db, id) }, 201);
    })

    .put(
      "/:id",
      allowSport("matches.manage"),
      validate("param", idParam),
      validate("json", matchUpdateInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const { version: asRead, ...input } = c.req.valid("json");
        const current = await findMatch(db, id);
        if (!current) return c.json({ message: MESSAGES.matchNotFound }, 404);
        if (current.divisionId !== input.divisionId) {
          return c.json({ message: "ย้ายแมตช์ไปประเภทอื่นไม่ได้" }, 400);
        }
        if (current.parentMatchId !== input.parentMatchId) {
          return c.json({ message: "ย้ายแมตช์ย่อยไปแมตช์หลักอื่นไม่ได้" }, 400);
        }
        const problem = await checkMatch(db, input);
        if (problem) return c.json({ message: problem }, 400);

        // Sides keep their rows (and lineups and check-ins) while their team
        // stays; a side whose team changes starts over as a new row.
        const sides = await db
          .select()
          .from(competitionMatchParticipant)
          .where(eq(competitionMatchParticipant.matchId, id));
        const bySlot = new Map(sides.map((side) => [side.slot, side]));
        const removed: string[] = [];
        const relabelled: { id: string; label: string | null }[] = [];
        const added: { teamId: string | null; label: string | null; slot: number }[] = [];
        input.participants.forEach((p, index) => {
          const slot = index + 1;
          const label = p.label || null;
          const side = bySlot.get(slot);
          if (side && side.teamId === p.teamId) {
            if (side.label !== label) relabelled.push({ id: side.id, label });
            return;
          }
          if (side) removed.push(side.id);
          added.push({ teamId: p.teamId, label, slot });
        });
        for (const side of sides) {
          if (side.slot > input.participants.length) removed.push(side.id);
        }
        if ((removed.length > 0 || added.length > 0) && hasStarted(current)) {
          return c.json({ message: STARTED }, 400);
        }

        const { participants, startAt, ...fields } = input;
        const teamIds = participants.flatMap((p) => (p.teamId ? [p.teamId] : []));
        try {
          await db.batch([
            ...guards(db, c.var.user, {
              extra: matchAsRead(id, asRead),
              divisionId: input.divisionId,
              teamIds,
            }),
            db
              .update(competitionMatch)
              .set({
                ...fields,
                startAt: startAt === null ? null : new Date(startAt),
                version: sql`${competitionMatch.version} + 1`,
              })
              .where(eq(competitionMatch.id, id)),
            ...removed.map((sideId) =>
              db
                .delete(competitionMatchParticipant)
                .where(eq(competitionMatchParticipant.id, sideId)),
            ),
            ...relabelled.map((side) =>
              db
                .update(competitionMatchParticipant)
                .set({ label: side.label })
                .where(eq(competitionMatchParticipant.id, side.id)),
            ),
            ...added.map((side) =>
              db.insert(competitionMatchParticipant).values({ matchId: id, ...side }),
            ),
            logCompetitionChange(db, c.var.user, "match", id, "update", input),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 200);
      },
    )

    .delete(
      "/:id",
      allowSport("matches.manage"),
      validate("param", idParam),
      validate("query", versionQuery),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const { version: asRead } = c.req.valid("query");
        const current = await findMatch(db, id);
        if (!current) return c.json({ message: MESSAGES.matchNotFound }, 404);
        if (hasStarted(current)) return c.json({ message: STARTED }, 400);
        try {
          await db.batch([
            ...guards(db, c.var.user, { extra: matchAsRead(id, asRead) }),
            db.delete(competitionMatch).where(eq(competitionMatch.id, id)),
            logCompetitionChange(db, c.var.user, "match", id, "delete", {
              divisionId: current.divisionId,
              matchNo: current.matchNo,
            }),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ ok: true }, 200);
      },
    )

    .post(
      "/:id/status",
      allowSport("matches.manage"),
      validate("param", idParam),
      validate("json", matchStatusInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const { status, version: asRead } = c.req.valid("json");
        const current = await findMatch(db, id);
        if (!current) return c.json({ message: MESSAGES.matchNotFound }, 404);
        if (current.status === "finished") return c.json({ message: FINISHED }, 400);
        try {
          await db.batch([
            ...guards(db, c.var.user, { extra: matchAsRead(id, asRead) }),
            db
              .update(competitionMatch)
              .set({ status, version: sql`${competitionMatch.version} + 1` })
              .where(eq(competitionMatch.id, id)),
            logCompetitionChange(db, c.var.user, "match", id, "status", {
              from: current.status,
              to: status,
            }),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 200);
      },
    )

    // A placeholder side ("ผู้ชนะ M3") gets its real team; the label stays as history.
    .post(
      "/:id/participants/:participantId/team",
      allowSport("matches.manage"),
      validate("param", participantParam),
      validate("json", placeholderTeamInput),
      async (c) => {
        const db = c.var.db;
        const { id, participantId } = c.req.valid("param");
        const { teamId, version: asRead } = c.req.valid("json");
        const current = await findMatch(db, id);
        if (!current) return c.json({ message: MESSAGES.matchNotFound }, 404);
        const [side] = await db
          .select()
          .from(competitionMatchParticipant)
          .where(
            and(
              eq(competitionMatchParticipant.id, participantId),
              eq(competitionMatchParticipant.matchId, id),
            ),
          );
        if (!side) return c.json({ message: PARTICIPANT_NOT_FOUND }, 404);
        if (side.teamId) return c.json({ message: NOT_PLACEHOLDER }, 400);
        const teamProblem = await checkTeams(db, current.divisionId, [teamId]);
        if (teamProblem) return c.json({ message: teamProblem }, 400);
        const [playing] = await db
          .select({ n: count() })
          .from(competitionMatchParticipant)
          .where(
            and(
              eq(competitionMatchParticipant.matchId, id),
              eq(competitionMatchParticipant.teamId, teamId),
            ),
          );
        if ((playing?.n ?? 0) > 0) return c.json({ message: TEAM_ALREADY_PLAYING }, 400);
        try {
          await db.batch([
            ...guards(db, c.var.user, {
              extra: matchAsRead(id, asRead),
              divisionId: current.divisionId,
              teamIds: [teamId],
            }),
            db
              .update(competitionMatchParticipant)
              .set({ teamId })
              .where(eq(competitionMatchParticipant.id, participantId)),
            db
              .update(competitionMatch)
              .set({ version: sql`${competitionMatch.version} + 1` })
              .where(eq(competitionMatch.id, id)),
            logCompetitionChange(db, c.var.user, "match", id, "placeholder", {
              participantId,
              label: side.label,
              teamId,
            }),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 200);
      },
    )

    // Referees ---------------------------------------------------------------

    .post(
      "/:id/referees",
      allowSport("matches.manage"),
      validate("param", idParam),
      validate("json", refereeInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const input = c.req.valid("json");
        if (!(await findMatch(db, id))) return c.json({ message: MESSAGES.matchNotFound }, 404);
        const refereeId = crypto.randomUUID();
        try {
          await db.batch([
            ...guards(db, c.var.user),
            db.insert(competitionMatchReferee).values({ id: refereeId, matchId: id, ...input }),
            logCompetitionChange(db, c.var.user, "match", id, "referee.add", {
              refereeId,
              ...input,
            }),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 201);
      },
    )

    .put(
      "/:id/referees/:refereeId",
      allowSport("matches.manage"),
      validate("param", refereeParam),
      validate("json", refereeInput),
      async (c) => {
        const db = c.var.db;
        const { id, refereeId } = c.req.valid("param");
        const input = c.req.valid("json");
        const where = and(
          eq(competitionMatchReferee.id, refereeId),
          eq(competitionMatchReferee.matchId, id),
        );
        const [found] = await db
          .select({ id: competitionMatchReferee.id })
          .from(competitionMatchReferee)
          .where(where);
        if (!found) return c.json({ message: REFEREE_NOT_FOUND }, 404);
        try {
          await db.batch([
            ...guards(db, c.var.user),
            db.update(competitionMatchReferee).set(input).where(where),
            logCompetitionChange(db, c.var.user, "match", id, "referee.update", {
              refereeId,
              ...input,
            }),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 200);
      },
    )

    .delete(
      "/:id/referees/:refereeId",
      allowSport("matches.manage"),
      validate("param", refereeParam),
      async (c) => {
        const db = c.var.db;
        const { id, refereeId } = c.req.valid("param");
        const where = and(
          eq(competitionMatchReferee.id, refereeId),
          eq(competitionMatchReferee.matchId, id),
        );
        const [found] = await db
          .select({ id: competitionMatchReferee.id, name: competitionMatchReferee.name })
          .from(competitionMatchReferee)
          .where(where);
        if (!found) return c.json({ message: REFEREE_NOT_FOUND }, 404);
        try {
          await db.batch([
            ...guards(db, c.var.user),
            db.delete(competitionMatchReferee).where(where),
            logCompetitionChange(db, c.var.user, "match", id, "referee.remove", {
              refereeId,
              name: found.name,
            }),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 200);
      },
    )

    // Images: one may be the cover, copied onto the match for lists. -----------

    .post(
      "/:id/images",
      allowSport("matches.manage"),
      validate("param", idParam),
      validate("json", matchImageInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const input = c.req.valid("json");
        if (!(await findMatch(db, id))) return c.json({ message: MESSAGES.matchNotFound }, 404);
        const imageId = crypto.randomUUID();
        try {
          await db.batch([
            ...guards(db, c.var.user),
            ...(input.isCover ? clearCover(db, id) : []),
            db.insert(competitionMatchImage).values({
              id: imageId,
              matchId: id,
              ...input,
              uploadedBy: c.var.user.id,
            }),
            ...(input.isCover ? [setCoverUrl(db, id, input.url)] : []),
            logCompetitionChange(db, c.var.user, "match", id, "image.add", {
              imageId,
              ...input,
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "unique") return c.json({ message: COVER_TAKEN }, 409);
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 201);
      },
    )

    .put(
      "/:id/images/:imageId",
      allowSport("matches.manage"),
      validate("param", imageParam),
      validate("json", matchImageInput),
      async (c) => {
        const db = c.var.db;
        const { id, imageId } = c.req.valid("param");
        const input = c.req.valid("json");
        const where = and(
          eq(competitionMatchImage.id, imageId),
          eq(competitionMatchImage.matchId, id),
        );
        const [found] = await db
          .select({ isCover: competitionMatchImage.isCover })
          .from(competitionMatchImage)
          .where(where);
        if (!found) return c.json({ message: IMAGE_NOT_FOUND }, 404);
        try {
          await db.batch([
            ...guards(db, c.var.user),
            ...(input.isCover ? clearCover(db, id) : []),
            db.update(competitionMatchImage).set(input).where(where),
            ...(input.isCover
              ? [setCoverUrl(db, id, input.url)]
              : found.isCover
                ? [setCoverUrl(db, id, null)]
                : []),
            logCompetitionChange(db, c.var.user, "match", id, "image.update", {
              imageId,
              ...input,
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "unique") return c.json({ message: COVER_TAKEN }, 409);
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 200);
      },
    )

    .delete(
      "/:id/images/:imageId",
      allowSport("matches.manage"),
      validate("param", imageParam),
      async (c) => {
        const db = c.var.db;
        const { id, imageId } = c.req.valid("param");
        const where = and(
          eq(competitionMatchImage.id, imageId),
          eq(competitionMatchImage.matchId, id),
        );
        const [found] = await db
          .select({ isCover: competitionMatchImage.isCover, url: competitionMatchImage.url })
          .from(competitionMatchImage)
          .where(where);
        if (!found) return c.json({ message: IMAGE_NOT_FOUND }, 404);
        try {
          await db.batch([
            ...guards(db, c.var.user),
            db.delete(competitionMatchImage).where(where),
            ...(found.isCover ? [setCoverUrl(db, id, null)] : []),
            logCompetitionChange(db, c.var.user, "match", id, "image.remove", {
              imageId,
              url: found.url,
            }),
          ]);
        } catch (error) {
          return c.json({ message: staleOr(error) }, 409);
        }
        return c.json({ match: await detailOrThrow(db, id) }, 200);
      },
    );

/** Unsets the match's current cover image, before another one takes its place. */
function clearCover(db: Database, matchId: string) {
  return [
    db
      .update(competitionMatchImage)
      .set({ isCover: false })
      .where(
        and(eq(competitionMatchImage.matchId, matchId), eq(competitionMatchImage.isCover, true)),
      ),
  ];
}

/** The cover as lists show it; not a change to the match itself, so no version bump. */
function setCoverUrl(db: Database, matchId: string, url: string | null) {
  return db
    .update(competitionMatch)
    .set({ coverImageUrl: url })
    .where(eq(competitionMatch.id, matchId));
}

export type CompetitionMatchRoutes = ReturnType<typeof createCompetitionMatchRoutes>;
