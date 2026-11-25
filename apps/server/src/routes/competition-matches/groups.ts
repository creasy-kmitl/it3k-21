// Groups (สาย) of a stage and the teams in each. Saves replace the whole team
// list and follow the version read.
import type { Database } from "@it3k/db";
import { groupInput } from "@it3k/db/competition-rules";
import { competitionGroup, competitionGroupTeam, competitionMatch } from "@it3k/db/schema/index";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { logCompetitionChange } from "../../competition/audit";
import { type CurrentUserEnv, constraintError } from "../../middleware/current-user";
import { allowSport } from "../../middleware/sport-permission";
import { validate } from "../../middleware/validation";
import { MESSAGES, checkTeams, chunks, guards, loadDivision, versionQuery } from "./shared";

const groupParam = z.strictObject({ groupId: z.string().min(1) });
const listQuery = z.strictObject({ divisionId: z.string().min(1) });
const groupUpdateInput = groupInput.extend({ version: z.number().int().min(0) });

const NAME_TAKEN = "มีสายชื่อนี้ในรอบนี้แล้ว";
const TEAM_IN_OTHER_GROUP = "มีทีมที่อยู่ในสายอื่นของรอบนี้แล้ว";
const GROUP_HAS_MATCHES = "สายนี้มีแมตช์อยู่ ลบแมตช์ก่อน";

/** A division's groups with their team ids, by stage then order. */
export async function listGroups(db: Database, divisionId: string) {
  const groups = await db
    .select({
      id: competitionGroup.id,
      divisionId: competitionGroup.divisionId,
      stageName: competitionGroup.stageName,
      name: competitionGroup.name,
      sortOrder: competitionGroup.sortOrder,
      version: competitionGroup.version,
    })
    .from(competitionGroup)
    .where(eq(competitionGroup.divisionId, divisionId))
    .orderBy(
      asc(competitionGroup.stageName),
      asc(competitionGroup.sortOrder),
      asc(competitionGroup.name),
    );
  const members =
    groups.length === 0
      ? []
      : await db
          .select({ groupId: competitionGroupTeam.groupId, teamId: competitionGroupTeam.teamId })
          .from(competitionGroupTeam)
          .where(
            inArray(
              competitionGroupTeam.groupId,
              groups.map((group) => group.id),
            ),
          )
          .orderBy(asc(competitionGroupTeam.seed));
  return groups.map((group) => ({
    ...group,
    teamIds: members.filter((m) => m.groupId === group.id).map((m) => m.teamId),
  }));
}

/** Why the group cannot be saved as asked, or null. */
async function checkGroup(db: Database, input: z.infer<typeof groupInput>, groupId: string | null) {
  const teamProblem = await checkTeams(db, input.divisionId, input.teamIds);
  if (teamProblem) return teamProblem;
  const others = await db
    .select({ id: competitionGroup.id, name: competitionGroup.name })
    .from(competitionGroup)
    .where(
      and(
        eq(competitionGroup.divisionId, input.divisionId),
        eq(competitionGroup.stageName, input.stageName),
        groupId ? ne(competitionGroup.id, groupId) : undefined,
      ),
    );
  if (others.some((group) => group.name === input.name)) return NAME_TAKEN;
  if (others.length > 0 && input.teamIds.length > 0) {
    const [clash] = await db
      .select({ teamId: competitionGroupTeam.teamId })
      .from(competitionGroupTeam)
      .where(
        and(
          inArray(
            competitionGroupTeam.groupId,
            others.map((group) => group.id),
          ),
          inArray(competitionGroupTeam.teamId, input.teamIds),
        ),
      )
      .limit(1);
    if (clash) return TEAM_IN_OTHER_GROUP;
  }
  return null;
}

function teamRows(db: Database, groupId: string, teamIds: readonly string[]) {
  return chunks(
    teamIds.map((teamId, index) => ({ groupId, teamId, seed: index + 1 })),
    3,
  ).map((rows) => db.insert(competitionGroupTeam).values(rows));
}

export const createGroupRoutes = () =>
  new Hono<CurrentUserEnv>()
    .get("/", validate("query", listQuery), async (c) => {
      const { divisionId } = c.req.valid("query");
      return c.json({ items: await listGroups(c.var.db, divisionId) }, 200);
    })

    .post("/", allowSport("matches.manage"), validate("json", groupInput), async (c) => {
      const db = c.var.db;
      const input = c.req.valid("json");
      if (!(await loadDivision(db, input.divisionId))) {
        return c.json({ message: MESSAGES.divisionNotFound }, 404);
      }
      const problem = await checkGroup(db, input, null);
      if (problem) return c.json({ message: problem }, 400);
      const id = crypto.randomUUID();
      const { teamIds, ...group } = input;
      try {
        await db.batch([
          ...guards(db, c.var.user, { divisionId: input.divisionId, teamIds }),
          db.insert(competitionGroup).values({ id, ...group }),
          ...teamRows(db, id, teamIds),
          logCompetitionChange(db, c.var.user, "group", id, "create", input),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        if (kind === "unique") return c.json({ message: NAME_TAKEN }, 409);
        if (kind === "stale") return c.json({ message: MESSAGES.stale }, 409);
        throw error;
      }
      return c.json({ items: await listGroups(db, input.divisionId), id }, 201);
    })

    .put(
      "/:groupId",
      allowSport("matches.manage"),
      validate("param", groupParam),
      validate("json", groupUpdateInput),
      async (c) => {
        const db = c.var.db;
        const { groupId } = c.req.valid("param");
        const { version, ...input } = c.req.valid("json");
        const [current] = await db
          .select({ divisionId: competitionGroup.divisionId })
          .from(competitionGroup)
          .where(eq(competitionGroup.id, groupId));
        if (!current) return c.json({ message: MESSAGES.groupNotFound }, 404);
        if (current.divisionId !== input.divisionId) {
          return c.json({ message: "ย้ายสายไปประเภทอื่นไม่ได้" }, 400);
        }
        const problem = await checkGroup(db, input, groupId);
        if (problem) return c.json({ message: problem }, 400);
        const { teamIds, divisionId: _division, ...group } = input;
        const asRead = sql`exists (select 1 from ${competitionGroup} where ${and(
          eq(competitionGroup.id, groupId),
          eq(competitionGroup.version, version),
        )})`;
        try {
          await db.batch([
            ...guards(db, c.var.user, { extra: asRead, divisionId: input.divisionId, teamIds }),
            db
              .update(competitionGroup)
              .set({ ...group, version: version + 1 })
              .where(eq(competitionGroup.id, groupId)),
            db.delete(competitionGroupTeam).where(eq(competitionGroupTeam.groupId, groupId)),
            ...teamRows(db, groupId, teamIds),
            logCompetitionChange(db, c.var.user, "group", groupId, "update", input),
          ]);
        } catch (error) {
          const kind = constraintError(error);
          if (kind === "unique") return c.json({ message: NAME_TAKEN }, 409);
          if (kind === "stale") return c.json({ message: MESSAGES.stale }, 409);
          throw error;
        }
        return c.json({ items: await listGroups(db, input.divisionId) }, 200);
      },
    )

    .delete(
      "/:groupId",
      allowSport("matches.manage"),
      validate("param", groupParam),
      validate("query", versionQuery),
      async (c) => {
        const db = c.var.db;
        const { groupId } = c.req.valid("param");
        const { version } = c.req.valid("query");
        const [current] = await db
          .select({ divisionId: competitionGroup.divisionId })
          .from(competitionGroup)
          .where(eq(competitionGroup.id, groupId));
        if (!current) return c.json({ message: MESSAGES.groupNotFound }, 404);
        const [used] = await db
          .select({ id: competitionMatch.id })
          .from(competitionMatch)
          .where(eq(competitionMatch.groupId, groupId))
          .limit(1);
        if (used) return c.json({ message: GROUP_HAS_MATCHES }, 409);
        const asRead = sql`exists (select 1 from ${competitionGroup} where ${and(
          eq(competitionGroup.id, groupId),
          eq(competitionGroup.version, version),
        )})`;
        try {
          await db.batch([
            ...guards(db, c.var.user, { extra: asRead }),
            db.delete(competitionGroup).where(eq(competitionGroup.id, groupId)),
            logCompetitionChange(db, c.var.user, "group", groupId, "delete"),
          ]);
        } catch (error) {
          const kind = constraintError(error);
          if (kind === "foreign-key") return c.json({ message: GROUP_HAS_MATCHES }, 409);
          if (kind === "stale") return c.json({ message: MESSAGES.stale }, 409);
          throw error;
        }
        return c.json({ items: await listGroups(db, current.divisionId) }, 200);
      },
    );
