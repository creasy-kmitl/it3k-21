// How each division competes: team sizes, lineups, scoring, standings and
// check-in. Everyone who reads competitions sees the settings; match managers
// change them. A save follows the version read, so two editors cannot
// overwrite each other.
import { divisionCompetitionInput } from "@it3k/db/competition-rules";
import { presetFor } from "@it3k/db/scoring/presets";
import { competitionMatch, competitionTeam, sport, sportDivision } from "@it3k/db/schema/index";
import type { Database } from "@it3k/db";
import { type SQL, and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { logCompetitionChange } from "../../competition/audit";
import {
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { allowSport } from "../../middleware/sport-permission";
import { validate } from "../../middleware/validation";
import { canSport, sportAccessIsAsRead } from "../../policies/sports";

const NOT_FOUND = "ไม่พบประเภทนี้";
const STALE = "การตั้งค่าถูกแก้ไขโดยคนอื่นแล้ว โหลดใหม่ก่อนบันทึก";

const idParam = z.strictObject({ id: z.string().min(1) });

const teamCounts = sql<number>`(select count(*) from ${competitionTeam} where ${competitionTeam.divisionId} = ${sportDivision.id})`;
const matchCounts = sql<number>`(select count(*) from ${competitionMatch} where ${competitionMatch.divisionId} = ${sportDivision.id} and ${competitionMatch.parentMatchId} is null)`;

const settingsColumns = {
  id: sportDivision.id,
  code: sportDivision.code,
  name: sportDivision.name,
  gender: sportDivision.gender,
  format: sportDivision.format,
  requiresBadmintonRank: sportDivision.requiresBadmintonRank,
  sportId: sport.id,
  sportName: sport.name,
  sportCode: sport.code,
  sportIcon: sport.icon,
  maxTeamsPerInstitution: sportDivision.maxTeamsPerInstitution,
  teamMinSize: sportDivision.teamMinSize,
  teamMaxSize: sportDivision.teamMaxSize,
  genderMinimums: sportDivision.genderMinimums,
  maxOfficials: sportDivision.maxOfficials,
  lineupStarters: sportDivision.lineupStarters,
  lineupMaxSubs: sportDivision.lineupMaxSubs,
  scoringConfig: sportDivision.scoringConfig,
  standingsConfig: sportDivision.standingsConfig,
  checkinMode: sportDivision.checkinMode,
  checkinOpensMin: sportDivision.checkinOpensMin,
  checkinClosesMin: sportDivision.checkinClosesMin,
  checkinMinPlayers: sportDivision.checkinMinPlayers,
  awardsMedals: sportDivision.awardsMedals,
  version: sportDivision.competitionVersion,
  teamCount: teamCounts,
  matchCount: matchCounts,
};

type SettingsRow = { code: string; format: (typeof sportDivision.$inferSelect)["format"] } & Record<
  string,
  unknown
>;

/** Fills in the scoring settings a division uses when staff set none. */
const withScoring = <T extends SettingsRow & { scoringConfig: unknown }>(row: T) => ({
  ...row,
  scoringConfig: row.scoringConfig ?? presetFor(row),
  scoringIsDefault: row.scoringConfig === null,
});

function selectSettings(db: Database, where?: SQL) {
  return db
    .select(settingsColumns)
    .from(sportDivision)
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .where(where)
    .orderBy(
      asc(sport.sortOrder),
      asc(sport.name),
      asc(sportDivision.sortOrder),
      asc(sportDivision.name),
    );
}

export const createCompetitionDivisionRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(allowSport("competition.read"))

    .get("/", async (c) => {
      const items = await selectSettings(c.var.db);
      return c.json(
        { items: items.map(withScoring), canManage: canSport(c.var.user, "matches.manage") },
        200,
      );
    })

    .get("/:id", validate("param", idParam), async (c) => {
      const [found] = await selectSettings(c.var.db, eq(sportDivision.id, c.req.valid("param").id));
      if (!found) return c.json({ message: NOT_FOUND }, 404);
      return c.json(
        { division: withScoring(found), canManage: canSport(c.var.user, "matches.manage") },
        200,
      );
    })

    .put(
      "/:id",
      allowSport("matches.manage"),
      validate("param", idParam),
      validate("json", divisionCompetitionInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const { version, ...settings } = c.req.valid("json");
        const [current] = await db
          .select({ id: sportDivision.id })
          .from(sportDivision)
          .where(eq(sportDivision.id, id));
        if (!current) return c.json({ message: NOT_FOUND }, 404);
        const asRead = sql`exists (select 1 from ${sportDivision} where ${and(
          eq(sportDivision.id, id),
          eq(sportDivision.competitionVersion, version),
        )})`;
        try {
          await db.batch([
            abortUnless(db, c.var.user.id, and(sportAccessIsAsRead(c.var.user), asRead) ?? sql`0`),
            db
              .update(sportDivision)
              .set({ ...settings, competitionVersion: version + 1 })
              .where(eq(sportDivision.id, id)),
            logCompetitionChange(db, c.var.user, "division", id, "settings", settings),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const [saved] = await selectSettings(db, eq(sportDivision.id, id));
        return c.json({ division: withScoring(saved as NonNullable<typeof saved>) }, 200);
      },
    );

export type CompetitionDivisionRoutes = ReturnType<typeof createCompetitionDivisionRoutes>;
