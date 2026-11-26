// A division's final places, for medals. A save replaces the whole list.
import type { Database } from "@it3k/db";
import { placementsInput } from "@it3k/db/competition-rules";
import { competitionPlacement } from "@it3k/db/schema/index";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { logCompetitionChange } from "../../competition/audit";
import { type CurrentUserEnv, constraintError } from "../../middleware/current-user";
import { allowSport } from "../../middleware/sport-permission";
import { validate } from "../../middleware/validation";
import { MESSAGES, checkTeams, chunks, divisionParam, guards, loadDivision } from "./shared";

async function listPlacements(db: Database, divisionId: string) {
  return db
    .select({ teamId: competitionPlacement.teamId, place: competitionPlacement.place })
    .from(competitionPlacement)
    .where(eq(competitionPlacement.divisionId, divisionId))
    .orderBy(asc(competitionPlacement.place));
}

export const createPlacementRoutes = () =>
  new Hono<CurrentUserEnv>()
    .get("/:divisionId", validate("param", divisionParam), async (c) => {
      const { divisionId } = c.req.valid("param");
      return c.json({ items: await listPlacements(c.var.db, divisionId) }, 200);
    })

    .put("/", allowSport("matches.manage"), validate("json", placementsInput), async (c) => {
      const db = c.var.db;
      const { divisionId, places } = c.req.valid("json");
      if (!(await loadDivision(db, divisionId))) {
        return c.json({ message: MESSAGES.divisionNotFound }, 404);
      }
      const teamIds = places.map((p) => p.teamId);
      const problem = await checkTeams(db, divisionId, teamIds);
      if (problem) return c.json({ message: problem }, 400);
      const rows = places.map((p) => ({
        teamId: p.teamId,
        divisionId,
        place: p.place,
        updatedBy: c.var.user.id,
      }));
      try {
        await db.batch([
          ...guards(db, c.var.user, { divisionId, teamIds }),
          db.delete(competitionPlacement).where(eq(competitionPlacement.divisionId, divisionId)),
          ...chunks(rows, 6).map((part) => db.insert(competitionPlacement).values(part)),
          logCompetitionChange(db, c.var.user, "placement", divisionId, "set", { places }),
        ]);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: MESSAGES.stale }, 409);
        throw error;
      }
      return c.json({ items: await listPlacements(db, divisionId) }, 200);
    });
