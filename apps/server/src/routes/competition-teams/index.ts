// Teams of each division: their members, officials and match lineups.
//
// Everyone who reads competitions sees teams; team managers change them, and
// match managers may also set lineups. Every write rechecks what it read in
// the same batch (abortUnless), so two editors cannot overwrite each other,
// and is logged with logCompetitionChange.
import type { Database } from "@it3k/db";
import {
  lineupInput,
  teamCreateInput,
  teamMembersInput,
  teamOfficialInput,
} from "@it3k/db/competition-rules";
import { INSTITUTION_IDS, type Institution } from "@it3k/db/profile";
import {
  competitionLineup,
  competitionMatch,
  competitionMatchParticipant,
  competitionTeam,
  competitionTeamMember,
  competitionTeamOfficial,
  sport,
  sportDivision,
  sportRegistration,
  user,
  userProfile,
} from "@it3k/db/schema/index";
import {
  AUTO_TEAMS_SKIPPED_SPORTS,
  dealIntoTeams,
  genderFromPrefix,
  nextFreeSeq,
  planDivisionTeams,
  teamAutoAllInput,
  teamAutoInput,
  teamIssues,
  teamLabel,
  teamRenameInput,
} from "@it3k/db/team-rules";
import { type SQL, and, asc, count, eq, inArray, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { loadMatch } from "../../competition/access";
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

const DIVISION_NOT_FOUND = "ไม่พบประเภทนี้";
const TEAM_NOT_FOUND = "ไม่พบทีมนี้";
const OFFICIAL_NOT_FOUND = "ไม่พบเจ้าหน้าที่ทีมคนนี้";
const MATCH_NOT_FOUND = "ไม่พบแมตช์นี้";
const STALE = "ข้อมูลทีมถูกแก้ไขโดยคนอื่นแล้ว โหลดใหม่ก่อนบันทึก";
const FORBIDDEN = "คุณไม่มีสิทธิ์ทำรายการนี้";

const idParam = z.strictObject({ id: z.string().min(1) });
const divisionParam = z.strictObject({ divisionId: z.string().min(1) });
const officialParam = z.strictObject({ id: z.string().min(1), officialId: z.string().min(1) });
const lineupParam = z.strictObject({
  matchId: z.string().min(1),
  participantId: z.string().min(1),
});
const listQuery = z.strictObject({
  divisionId: z.string().min(1).optional(),
  institution: z.enum(INSTITUTION_IDS).optional(),
});
const institutionQuery = z.strictObject({ institution: z.enum(INSTITUTION_IDS).optional() });

/** Team managers or match managers set a match's lineups. */
const mayEditLineups = (actor: Parameters<typeof canSport>[0]) =>
  canSport(actor, "teams.manage") || canSport(actor, "matches.manage");

const allowLineups = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!mayEditLineups(c.var.user)) return c.json({ message: FORBIDDEN }, 403);
  await next();
});

const divisionColumns = {
  id: sportDivision.id,
  code: sportDivision.code,
  name: sportDivision.name,
  gender: sportDivision.gender,
  format: sportDivision.format,
  requiresShirtNumber: sportDivision.requiresShirtNumber,
  requiresBadmintonRank: sportDivision.requiresBadmintonRank,
  sportId: sport.id,
  sportName: sport.name,
  sportIcon: sport.icon,
  maxTeamsPerInstitution: sportDivision.maxTeamsPerInstitution,
  teamMinSize: sportDivision.teamMinSize,
  teamMaxSize: sportDivision.teamMaxSize,
  genderMinimums: sportDivision.genderMinimums,
  maxOfficials: sportDivision.maxOfficials,
  lineupStarters: sportDivision.lineupStarters,
  lineupMaxSubs: sportDivision.lineupMaxSubs,
};

type DivisionRow = Awaited<ReturnType<typeof loadDivision>> & {};

async function loadDivision(db: Database, divisionId: string) {
  const [row] = await db
    .select(divisionColumns)
    .from(sportDivision)
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .where(eq(sportDivision.id, divisionId));
  return row ?? null;
}

const firstName = sql<string>`coalesce(nullif(trim(json_extract(${userProfile.values}, '$.firstName')), ''), ${user.name})`;
const lastName = sql<string>`coalesce(json_extract(${userProfile.values}, '$.lastName'), '')`;
const nickname = sql<string>`coalesce(json_extract(${userProfile.values}, '$.nickname'), '')`;
const prefix = sql<string>`coalesce(json_extract(${userProfile.values}, '$.prefix'), '')`;

/** Teams (in `where`) with their members, officials and what they still lack. */
async function selectTeams(db: Database, where: SQL | undefined) {
  const teams = await db
    .select({
      team: competitionTeam,
      division: {
        format: sportDivision.format,
        teamMinSize: sportDivision.teamMinSize,
        teamMaxSize: sportDivision.teamMaxSize,
        genderMinimums: sportDivision.genderMinimums,
        maxOfficials: sportDivision.maxOfficials,
        maxTeamsPerInstitution: sportDivision.maxTeamsPerInstitution,
      },
    })
    .from(competitionTeam)
    .innerJoin(sportDivision, eq(sportDivision.id, competitionTeam.divisionId))
    .where(where)
    .orderBy(
      asc(competitionTeam.divisionId),
      asc(competitionTeam.institution),
      asc(competitionTeam.seq),
    );
  if (teams.length === 0) return [];
  const ids = teams.map((row) => row.team.id);
  const [members, officials] = await Promise.all([
    db
      .select({
        teamId: competitionTeamMember.teamId,
        registrationId: competitionTeamMember.registrationId,
        userId: competitionTeamMember.userId,
        displayName: competitionTeamMember.displayName,
        sortOrder: competitionTeamMember.sortOrder,
        status: sportRegistration.status,
        shirtNumber: sportRegistration.shirtNumber,
        badmintonRank: sportRegistration.badmintonRank,
        prefix,
      })
      .from(competitionTeamMember)
      .innerJoin(sportRegistration, eq(sportRegistration.id, competitionTeamMember.registrationId))
      .leftJoin(userProfile, eq(userProfile.userId, competitionTeamMember.userId))
      .where(inArray(competitionTeamMember.teamId, ids))
      .orderBy(asc(competitionTeamMember.sortOrder), asc(competitionTeamMember.displayName)),
    db
      .select()
      .from(competitionTeamOfficial)
      .where(inArray(competitionTeamOfficial.teamId, ids))
      .orderBy(asc(competitionTeamOfficial.sortOrder), asc(competitionTeamOfficial.createdAt)),
  ]);
  return teams.map(({ team, division }) => {
    const own = members
      .filter((member) => member.teamId === team.id)
      .map(({ teamId: _teamId, prefix: title, ...member }) => ({
        ...member,
        gender: genderFromPrefix(title),
      }));
    const staff = officials
      .filter((official) => official.teamId === team.id)
      .map(
        ({ teamId: _teamId, createdAt: _createdAt, updatedAt: _updatedAt, ...official }) =>
          official,
      );
    return {
      ...team,
      label: teamLabel(team, division.maxTeamsPerInstitution > 1),
      members: own,
      officials: staff,
      issues: teamIssues(division, own, staff.length),
    };
  });
}

async function loadTeam(db: Database, id: string) {
  const [row] = await db.select().from(competitionTeam).where(eq(competitionTeam.id, id));
  return row ?? null;
}

/** SQL: the team is still at the version the route read. */
function teamAsRead(id: string, version: number): SQL {
  return sql`exists (select 1 from ${competitionTeam} where ${and(
    eq(competitionTeam.id, id),
    eq(competitionTeam.version, version),
  )})`;
}

/** SQL: every one of `ids` is an approved registration of this division and institution. */
function allApproved(ids: readonly string[], divisionId: string, institution: Institution): SQL {
  if (ids.length === 0) return sql`1`;
  return sql`(select count(*) from ${sportRegistration} where ${and(
    inArray(sportRegistration.id, [...ids]),
    eq(sportRegistration.divisionId, divisionId),
    eq(sportRegistration.institution, institution),
    eq(sportRegistration.status, "approved"),
  )}) = ${ids.length}`;
}

/** The registrations a member list names, with what joining copies from them. */
async function loadRegistrations(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: sportRegistration.id,
      userId: sportRegistration.userId,
      divisionId: sportRegistration.divisionId,
      institution: sportRegistration.institution,
      status: sportRegistration.status,
      firstName,
      teamId: competitionTeamMember.teamId,
    })
    .from(sportRegistration)
    .innerJoin(user, eq(user.id, sportRegistration.userId))
    .leftJoin(userProfile, eq(userProfile.userId, sportRegistration.userId))
    .leftJoin(competitionTeamMember, eq(competitionTeamMember.registrationId, sportRegistration.id))
    .where(inArray(sportRegistration.id, [...ids]));
}

const officialValues = (input: z.infer<typeof teamOfficialInput>) => ({
  name: input.name,
  position: input.position || null,
  description: input.description || null,
  photoUrl: input.photoUrl || null,
  sortOrder: input.sortOrder,
});

/** Statements that drop a team's removed members from lineups of matches not yet played. */
function pruneLineups(db: Database, teamId: string, keep: readonly string[]) {
  return db
    .delete(competitionLineup)
    .where(
      and(
        sql`${competitionLineup.participantId} in (select ${competitionMatchParticipant.id} from ${competitionMatchParticipant} where ${competitionMatchParticipant.teamId} = ${teamId})`,
        sql`${competitionLineup.matchId} in (select ${competitionMatch.id} from ${competitionMatch} where ${competitionMatch.status} not in ('finished', 'cancelled'))`,
        keep.length > 0 ? notInArray(competitionLineup.registrationId, [...keep]) : undefined,
      ),
    );
}

export const createCompetitionTeamRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(allowSport("competition.read"))

    .get("/", validate("query", listQuery), async (c) => {
      const { divisionId, institution } = c.req.valid("query");
      const items = await selectTeams(
        c.var.db,
        and(
          divisionId ? eq(competitionTeam.divisionId, divisionId) : undefined,
          institution ? eq(competitionTeam.institution, institution) : undefined,
        ),
      );
      return c.json({ items, canManage: canSport(c.var.user, "teams.manage") }, 200);
    })

    // One division's teams with the registrations they are built from.
    .get(
      "/division/:divisionId",
      validate("param", divisionParam),
      validate("query", institutionQuery),
      async (c) => {
        const db = c.var.db;
        const { divisionId } = c.req.valid("param");
        const { institution } = c.req.valid("query");
        const division = await loadDivision(db, divisionId);
        if (!division) return c.json({ message: DIVISION_NOT_FOUND }, 404);
        const scoped = (
          column: typeof competitionTeam.institution | typeof sportRegistration.institution,
        ) => (institution ? eq(column, institution) : undefined);
        const [teams, athletes] = await Promise.all([
          selectTeams(
            db,
            and(eq(competitionTeam.divisionId, divisionId), scoped(competitionTeam.institution)),
          ),
          db
            .select({
              registrationId: sportRegistration.id,
              userId: sportRegistration.userId,
              institution: sportRegistration.institution,
              status: sportRegistration.status,
              shirtNumber: sportRegistration.shirtNumber,
              badmintonRank: sportRegistration.badmintonRank,
              firstName,
              lastName,
              nickname,
              prefix,
              teamId: competitionTeamMember.teamId,
            })
            .from(sportRegistration)
            .innerJoin(user, eq(user.id, sportRegistration.userId))
            .leftJoin(userProfile, eq(userProfile.userId, sportRegistration.userId))
            .leftJoin(
              competitionTeamMember,
              eq(competitionTeamMember.registrationId, sportRegistration.id),
            )
            .where(
              and(
                eq(sportRegistration.divisionId, divisionId),
                scoped(sportRegistration.institution),
              ),
            )
            .orderBy(
              asc(sportRegistration.institution),
              sql`${sportRegistration.shirtNumber} is null`,
              asc(sportRegistration.shirtNumber),
              asc(firstName),
            ),
        ]);
        return c.json(
          {
            division,
            teams,
            // Rejected registrations matter only while they are still in a team.
            athletes: athletes
              .filter((athlete) => athlete.status !== "rejected" || athlete.teamId !== null)
              .map(({ prefix: title, ...athlete }) => ({
                ...athlete,
                gender: genderFromPrefix(title),
              })),
            canManage: canSport(c.var.user, "teams.manage"),
          },
          200,
        );
      },
    )

    .post("/", allowSport("teams.manage"), validate("json", teamCreateInput), async (c) => {
      const db = c.var.db;
      const input = c.req.valid("json");
      const division = await loadDivision(db, input.divisionId);
      if (!division) return c.json({ message: DIVISION_NOT_FOUND }, 404);
      const existing = await db
        .select({ seq: competitionTeam.seq })
        .from(competitionTeam)
        .where(
          and(
            eq(competitionTeam.divisionId, input.divisionId),
            eq(competitionTeam.institution, input.institution),
          ),
        );
      if (existing.length >= division.maxTeamsPerInstitution) {
        return c.json(
          { message: `ประเภทนี้ส่งได้มหาลัยละไม่เกิน ${division.maxTeamsPerInstitution} ทีม` },
          409,
        );
      }
      const seq = input.seq ?? nextFreeSeq(existing.map((row) => row.seq));
      const id = crypto.randomUUID();
      const values = {
        id,
        divisionId: input.divisionId,
        institution: input.institution,
        seq,
        name: input.name || null,
      };
      // The cap is read again inside the batch, from the division's current setting.
      const underCap = sql`(select count(*) from ${competitionTeam} where ${and(
        eq(competitionTeam.divisionId, input.divisionId),
        eq(competitionTeam.institution, input.institution),
      )}) < (select ${sportDivision.maxTeamsPerInstitution} from ${sportDivision} where ${sportDivision.id} = ${input.divisionId})`;
      try {
        await db.batch([
          abortUnless(db, c.var.user.id, and(sportAccessIsAsRead(c.var.user), underCap) ?? sql`0`),
          db.insert(competitionTeam).values(values),
          logCompetitionChange(db, c.var.user, "team", id, "create", values),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        if (kind === "unique") return c.json({ message: `มีทีมหมายเลข ${seq} แล้ว` }, 409);
        if (kind === "stale") return c.json({ message: STALE }, 409);
        throw error;
      }
      const [team] = await selectTeams(db, eq(competitionTeam.id, id));
      return c.json({ team: team as NonNullable<typeof team> }, 201);
    })

    // Every approved athlete into team 1, or dealt in turn into n teams.
    .post("/auto", allowSport("teams.manage"), validate("json", teamAutoInput), async (c) => {
      const db = c.var.db;
      const { divisionId, institution, teamCount } = c.req.valid("json");
      const division = await loadDivision(db, divisionId);
      if (!division) return c.json({ message: DIVISION_NOT_FOUND }, 404);
      if (teamCount > division.maxTeamsPerInstitution) {
        return c.json(
          { message: `ประเภทนี้ส่งได้มหาลัยละไม่เกิน ${division.maxTeamsPerInstitution} ทีม` },
          400,
        );
      }
      const sameInstitution = and(
        eq(competitionTeam.divisionId, divisionId),
        eq(competitionTeam.institution, institution),
      );
      const [teams, athletes] = await Promise.all([
        db.select().from(competitionTeam).where(sameInstitution).orderBy(asc(competitionTeam.seq)),
        db
          .select({
            id: sportRegistration.id,
            userId: sportRegistration.userId,
            badmintonRank: sportRegistration.badmintonRank,
            firstName,
          })
          .from(sportRegistration)
          .innerJoin(user, eq(user.id, sportRegistration.userId))
          .leftJoin(userProfile, eq(userProfile.userId, sportRegistration.userId))
          .where(
            and(
              eq(sportRegistration.divisionId, divisionId),
              eq(sportRegistration.institution, institution),
              eq(sportRegistration.status, "approved"),
            ),
          )
          .orderBy(
            sql`${sportRegistration.shirtNumber} is null`,
            asc(sportRegistration.shirtNumber),
            asc(firstName),
            asc(sportRegistration.id),
          ),
      ]);
      const targets = Array.from({ length: teamCount }, (_, index) => {
        const seq = index + 1;
        const found = teams.find((team) => team.seq === seq);
        return found
          ? { id: found.id, version: found.version, isNew: false }
          : { id: crypto.randomUUID(), version: 0, isNew: true };
      });
      const dealt = dealIntoTeams(athletes, teamCount, division.requiresBadmintonRank);
      const unchanged = and(
        sportAccessIsAsRead(c.var.user),
        sql`(select count(*) from ${competitionTeam} where ${sameInstitution}) = ${teams.length}`,
        ...teams.map((team) => teamAsRead(team.id, team.version)),
        allApproved(
          athletes.map((athlete) => athlete.id),
          divisionId,
          institution,
        ),
        sql`(select count(*) from ${sportRegistration} where ${and(
          eq(sportRegistration.divisionId, divisionId),
          eq(sportRegistration.institution, institution),
          eq(sportRegistration.status, "approved"),
        )}) = ${athletes.length}`,
      );
      const memberRows = targets.flatMap((target, index) =>
        (dealt[index] ?? []).map((athlete, order) => ({
          teamId: target.id,
          registrationId: athlete.id,
          userId: athlete.userId,
          displayName: athlete.firstName,
          sortOrder: order,
        })),
      );
      const newTeams = targets
        .map((target, index) => ({ ...target, seq: index + 1 }))
        .filter((target) => target.isNew)
        .map((target) => ({ id: target.id, divisionId, institution, seq: target.seq }));
      try {
        await db.batch([
          abortUnless(db, c.var.user.id, unchanged ?? sql`0`),
          ...(newTeams.length > 0 ? [db.insert(competitionTeam).values(newTeams)] : []),
          ...teams.map((team) =>
            db.delete(competitionTeamMember).where(eq(competitionTeamMember.teamId, team.id)),
          ),
          ...(memberRows.length > 0 ? [db.insert(competitionTeamMember).values(memberRows)] : []),
          ...teams.map((team) =>
            db
              .update(competitionTeam)
              .set({ version: team.version + 1 })
              .where(eq(competitionTeam.id, team.id)),
          ),
          ...teams.map((team) =>
            pruneLineups(
              db,
              team.id,
              memberRows.filter((row) => row.teamId === team.id).map((row) => row.registrationId),
            ),
          ),
          logCompetitionChange(db, c.var.user, "team", divisionId, "auto", {
            institution,
            teamCount,
            teams: targets.map((target, index) => ({
              id: target.id,
              registrationIds: (dealt[index] ?? []).map((athlete) => athlete.id),
            })),
          }),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        if (kind === "stale" || kind === "unique") return c.json({ message: STALE }, 409);
        throw error;
      }
      const items = await selectTeams(db, sameInstitution);
      return c.json({ items }, 200);
    })

    // Every division but badminton's at once: one team of all approved athletes
    // for each institution that has not put anyone in a team yet. `dryRun`
    // only reports the plan, so staff can confirm it first.
    .post(
      "/auto-all",
      allowSport("teams.manage"),
      validate("json", teamAutoAllInput),
      async (c) => {
        const db = c.var.db;
        const { dryRun } = c.req.valid("json");
        const [divisions, teams, approved] = await Promise.all([
          db
            .select({
              id: sportDivision.id,
              name: sportDivision.name,
              sportCode: sport.code,
              sportName: sport.name,
              sportIcon: sport.icon,
              teamMaxSize: sportDivision.teamMaxSize,
            })
            .from(sportDivision)
            .innerJoin(sport, eq(sport.id, sportDivision.sportId))
            .orderBy(asc(sport.sortOrder), asc(sportDivision.sortOrder)),
          db
            .select({
              id: competitionTeam.id,
              divisionId: competitionTeam.divisionId,
              institution: competitionTeam.institution,
              seq: competitionTeam.seq,
              version: competitionTeam.version,
              members: count(competitionTeamMember.registrationId),
            })
            .from(competitionTeam)
            .leftJoin(competitionTeamMember, eq(competitionTeamMember.teamId, competitionTeam.id))
            .groupBy(competitionTeam.id),
          db
            .select({
              id: sportRegistration.id,
              userId: sportRegistration.userId,
              divisionId: sportRegistration.divisionId,
              institution: sportRegistration.institution,
              firstName,
            })
            .from(sportRegistration)
            .innerJoin(user, eq(user.id, sportRegistration.userId))
            .leftJoin(userProfile, eq(userProfile.userId, sportRegistration.userId))
            .where(eq(sportRegistration.status, "approved"))
            .orderBy(
              sql`${sportRegistration.shirtNumber} is null`,
              asc(sportRegistration.shirtNumber),
              asc(firstName),
              asc(sportRegistration.id),
            ),
        ]);
        const skippedSports = new Set<string>(AUTO_TEAMS_SKIPPED_SPORTS);
        const plans = divisions
          .filter((division) => !skippedSports.has(division.sportCode))
          .map((division) => ({
            division,
            teams: teams.filter((team) => team.divisionId === division.id),
            approved: approved.filter((athlete) => athlete.divisionId === division.id),
          }))
          .map((entry) => ({ ...entry, plan: planDivisionTeams(entry.teams, entry.approved) }))
          .filter(({ plan }) => plan.create.length > 0 || plan.skipped.length > 0);

        const failed: string[] = [];
        if (!dryRun) {
          // One batch per division, each guarded on what was read for it.
          for (const { division, teams: read, plan } of plans) {
            if (plan.create.length === 0) continue;
            const institutions = plan.create.map((entry) => entry.institution);
            const sameTeams = and(
              eq(competitionTeam.divisionId, division.id),
              inArray(competitionTeam.institution, institutions),
            );
            const readTeams = read.filter((team) => institutions.includes(team.institution));
            const ids = plan.create.flatMap((entry) => entry.athletes.map((athlete) => athlete.id));
            const unchanged = and(
              sportAccessIsAsRead(c.var.user),
              sql`(select count(*) from ${competitionTeam} where ${sameTeams}) = ${readTeams.length}`,
              ...readTeams.map((team) => teamAsRead(team.id, team.version)),
              sql`not exists (select 1 from ${competitionTeamMember} where ${competitionTeamMember.teamId} in (select ${competitionTeam.id} from ${competitionTeam} where ${sameTeams}))`,
              sql`(select count(*) from ${sportRegistration} where ${and(
                eq(sportRegistration.divisionId, division.id),
                inArray(sportRegistration.institution, institutions),
                eq(sportRegistration.status, "approved"),
              )}) = ${ids.length}`,
              sql`(select count(*) from ${sportRegistration} where ${and(
                inArray(sportRegistration.id, ids),
                eq(sportRegistration.status, "approved"),
              )}) = ${ids.length}`,
            );
            const targets = plan.create.map((entry) => ({
              ...entry,
              teamId: entry.team?.id ?? crypto.randomUUID(),
            }));
            const newTeams = targets
              .filter((entry) => entry.team === null)
              .map((entry) => ({
                id: entry.teamId,
                divisionId: division.id,
                institution: entry.institution,
                seq: 1,
              }));
            const memberRows = targets.flatMap((entry) =>
              entry.athletes.map((athlete, order) => ({
                teamId: entry.teamId,
                registrationId: athlete.id,
                userId: athlete.userId,
                displayName: athlete.firstName,
                sortOrder: order,
              })),
            );
            try {
              await db.batch([
                abortUnless(db, c.var.user.id, unchanged ?? sql`0`),
                ...(newTeams.length > 0 ? [db.insert(competitionTeam).values(newTeams)] : []),
                db.insert(competitionTeamMember).values(memberRows),
                ...targets
                  .filter((entry) => entry.team !== null)
                  .map((entry) =>
                    db
                      .update(competitionTeam)
                      .set({ version: (entry.team?.version ?? 0) + 1 })
                      .where(eq(competitionTeam.id, entry.teamId)),
                  ),
                logCompetitionChange(db, c.var.user, "team", division.id, "auto", {
                  all: true,
                  teams: targets.map((entry) => ({
                    id: entry.teamId,
                    institution: entry.institution,
                    registrationIds: entry.athletes.map((athlete) => athlete.id),
                  })),
                }),
              ]);
            } catch (error) {
              const kind = constraintError(error);
              if (kind !== "stale" && kind !== "unique") throw error;
              failed.push(division.id);
            }
          }
        }

        return c.json(
          {
            applied: !dryRun,
            failed,
            skippedDivisions: divisions
              .filter((division) => skippedSports.has(division.sportCode))
              .map((division) => division.name),
            divisions: plans.map(({ division, plan }) => ({
              id: division.id,
              name: division.name,
              sportName: division.sportName,
              sportIcon: division.sportIcon,
              create: plan.create.map((entry) => ({
                institution: entry.institution,
                members: entry.athletes.length,
                overMax:
                  division.teamMaxSize !== null && entry.athletes.length > division.teamMaxSize,
              })),
              skipped: plan.skipped,
            })),
          },
          200,
        );
      },
    )

    .get("/lineups/:matchId/:participantId", validate("param", lineupParam), async (c) => {
      const db = c.var.db;
      const { matchId, participantId } = c.req.valid("param");
      const match = await loadMatch(db, matchId);
      const side = match?.participants.find((participant) => participant.id === participantId);
      if (!match || !side) return c.json({ message: MATCH_NOT_FOUND }, 404);
      const [team] = side.teamId ? await selectTeams(db, eq(competitionTeam.id, side.teamId)) : [];
      const lineup = await db
        .select({ registrationId: competitionLineup.registrationId, role: competitionLineup.role })
        .from(competitionLineup)
        .leftJoin(
          competitionTeamMember,
          eq(competitionTeamMember.registrationId, competitionLineup.registrationId),
        )
        .where(eq(competitionLineup.participantId, participantId))
        // In the team's own order, the way the editor lists members.
        .orderBy(asc(competitionTeamMember.sortOrder), asc(competitionLineup.registrationId));
      return c.json(
        {
          team: team ?? null,
          starters: lineup.filter((row) => row.role === "starter").map((row) => row.registrationId),
          subs: lineup.filter((row) => row.role === "sub").map((row) => row.registrationId),
          limits: {
            starters: match.division.lineupStarters,
            maxSubs: match.division.lineupMaxSubs,
          },
          locked: match.status === "finished" || match.status === "cancelled",
          canEdit: mayEditLineups(c.var.user),
        },
        200,
      );
    })

    .put(
      "/lineups/:matchId/:participantId",
      allowLineups,
      validate("param", lineupParam),
      validate("json", lineupInput),
      async (c) => {
        const db = c.var.db;
        const { matchId, participantId } = c.req.valid("param");
        const { starters, subs } = c.req.valid("json");
        const match = await loadMatch(db, matchId);
        const side = match?.participants.find((participant) => participant.id === participantId);
        if (!match || !side) return c.json({ message: MATCH_NOT_FOUND }, 404);
        if (!side.teamId) return c.json({ message: "ฝั่งนี้ยังไม่มีทีม" }, 409);
        if (match.status === "finished" || match.status === "cancelled") {
          return c.json({ message: "แมตช์นี้จบแล้ว แก้รายชื่อไม่ได้" }, 409);
        }
        const limit = match.division.lineupStarters;
        if (limit === null) return c.json({ message: "ประเภทนี้ไม่ต้องส่งรายชื่อลงแข่ง" }, 400);
        const maxSubs = match.division.lineupMaxSubs ?? 0;
        const all = [...starters, ...subs];
        if (new Set(all).size !== all.length) {
          return c.json({ message: "นักกีฬาคนหนึ่งอยู่ได้ตำแหน่งเดียว" }, 400);
        }
        if (starters.length > limit) {
          return c.json({ message: `ตัวจริงได้ไม่เกิน ${limit} คน` }, 400);
        }
        if (subs.length > maxSubs) {
          return c.json({ message: `ตัวสำรองได้ไม่เกิน ${maxSubs} คน` }, 400);
        }
        const team = await loadTeam(db, side.teamId);
        if (!team) return c.json({ message: TEAM_NOT_FOUND }, 404);
        const members = await db
          .select({ registrationId: competitionTeamMember.registrationId })
          .from(competitionTeamMember)
          .where(eq(competitionTeamMember.teamId, team.id));
        const memberIds = new Set(members.map((member) => member.registrationId));
        if (all.some((id) => !memberIds.has(id))) {
          return c.json({ message: "เลือกได้เฉพาะนักกีฬาในทีมนี้" }, 400);
        }
        const notFinished = sql`exists (select 1 from ${competitionMatch} where ${competitionMatch.id} = ${matchId} and ${competitionMatch.status} not in ('finished', 'cancelled'))`;
        const rows = [
          ...starters.map((registrationId) => ({ registrationId, role: "starter" as const })),
          ...subs.map((registrationId) => ({ registrationId, role: "sub" as const })),
        ].map((row) => ({ ...row, participantId, matchId }));
        try {
          await db.batch([
            abortUnless(
              db,
              c.var.user.id,
              and(
                sportAccessIsAsRead(c.var.user),
                teamAsRead(team.id, team.version),
                notFinished,
              ) ?? sql`0`,
            ),
            db.delete(competitionLineup).where(eq(competitionLineup.participantId, participantId)),
            ...(rows.length > 0 ? [db.insert(competitionLineup).values(rows)] : []),
            logCompetitionChange(db, c.var.user, "lineup", participantId, "set", {
              matchId,
              teamId: team.id,
              starters,
              subs,
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        return c.json({ starters, subs }, 200);
      },
    )

    .patch(
      "/:id",
      allowSport("teams.manage"),
      validate("param", idParam),
      validate("json", teamRenameInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const { name, version } = c.req.valid("json");
        const team = await loadTeam(db, id);
        if (!team) return c.json({ message: TEAM_NOT_FOUND }, 404);
        try {
          await db.batch([
            abortUnless(
              db,
              c.var.user.id,
              and(sportAccessIsAsRead(c.var.user), teamAsRead(id, version)) ?? sql`0`,
            ),
            db
              .update(competitionTeam)
              .set({ name: name || null, version: version + 1 })
              .where(eq(competitionTeam.id, id)),
            logCompetitionChange(db, c.var.user, "team", id, "rename", {
              name: [team.name, name || null],
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const [saved] = await selectTeams(db, eq(competitionTeam.id, id));
        return c.json({ team: saved as NonNullable<typeof saved> }, 200);
      },
    )

    .delete("/:id", allowSport("teams.manage"), validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      const team = await loadTeam(db, id);
      if (!team) return c.json({ message: TEAM_NOT_FOUND }, 404);
      const inMatch = sql`exists (select 1 from ${competitionMatchParticipant} where ${competitionMatchParticipant.teamId} = ${id})`;
      const [played] = await db
        .select({ id: competitionMatchParticipant.id })
        .from(competitionMatchParticipant)
        .where(eq(competitionMatchParticipant.teamId, id))
        .limit(1);
      if (played) return c.json({ message: "ทีมนี้มีแมตช์แล้ว ลบไม่ได้" }, 409);
      try {
        await db.batch([
          abortUnless(
            db,
            c.var.user.id,
            and(sportAccessIsAsRead(c.var.user), sql`not ${inMatch}`) ?? sql`0`,
          ),
          db.delete(competitionTeam).where(eq(competitionTeam.id, id)),
          logCompetitionChange(db, c.var.user, "team", id, "delete", {
            divisionId: team.divisionId,
            institution: team.institution,
            seq: team.seq,
          }),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        if (kind === "stale" || kind === "foreign-key") {
          return c.json({ message: "ทีมนี้มีแมตช์แล้ว ลบไม่ได้" }, 409);
        }
        throw error;
      }
      return c.json({ ok: true }, 200);
    })

    // The whole member list at once, at the version the editor read.
    .put(
      "/:id/members",
      allowSport("teams.manage"),
      validate("param", idParam),
      validate("json", teamMembersInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const { registrationIds, version } = c.req.valid("json");
        const team = await loadTeam(db, id);
        if (!team) return c.json({ message: TEAM_NOT_FOUND }, 404);
        if (team.version !== version) return c.json({ message: STALE }, 409);
        if (new Set(registrationIds).size !== registrationIds.length) {
          return c.json({ message: "มีนักกีฬาซ้ำในรายชื่อ" }, 400);
        }
        const found = await loadRegistrations(db, registrationIds);
        const byId = new Map(found.map((row) => [row.id, row]));
        for (const registrationId of registrationIds) {
          const row = byId.get(registrationId);
          if (!row || row.divisionId !== team.divisionId || row.institution !== team.institution) {
            return c.json({ message: "เลือกได้เฉพาะนักกีฬาของมหาลัยนี้ในประเภทนี้" }, 400);
          }
          if (row.status !== "approved") {
            return c.json({ message: `${row.firstName} ยังไม่ได้รับอนุมัติ` }, 400);
          }
          if (row.teamId !== null && row.teamId !== id) {
            return c.json({ message: `${row.firstName} อยู่ในทีมอื่นแล้ว` }, 409);
          }
        }
        const rows = registrationIds.map((registrationId, sortOrder) => {
          const row = byId.get(registrationId) as NonNullable<ReturnType<typeof byId.get>>;
          return {
            teamId: id,
            registrationId,
            userId: row.userId,
            displayName: row.firstName,
            sortOrder,
          };
        });
        try {
          await db.batch([
            abortUnless(
              db,
              c.var.user.id,
              and(
                sportAccessIsAsRead(c.var.user),
                teamAsRead(id, version),
                allApproved(registrationIds, team.divisionId, team.institution),
              ) ?? sql`0`,
            ),
            db.delete(competitionTeamMember).where(eq(competitionTeamMember.teamId, id)),
            ...(rows.length > 0 ? [db.insert(competitionTeamMember).values(rows)] : []),
            db
              .update(competitionTeam)
              .set({ version: version + 1 })
              .where(eq(competitionTeam.id, id)),
            pruneLineups(db, id, registrationIds),
            logCompetitionChange(db, c.var.user, "team", id, "members", { registrationIds }),
          ]);
        } catch (error) {
          const kind = constraintError(error);
          // Unique: another editor put one of them in another team meanwhile.
          if (kind === "stale" || kind === "unique") return c.json({ message: STALE }, 409);
          throw error;
        }
        const [saved] = await selectTeams(db, eq(competitionTeam.id, id));
        return c.json({ team: saved as NonNullable<typeof saved> }, 200);
      },
    )

    .post(
      "/:id/officials",
      allowSport("teams.manage"),
      validate("param", idParam),
      validate("json", teamOfficialInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const input = c.req.valid("json");
        const team = await loadTeam(db, id);
        if (!team) return c.json({ message: TEAM_NOT_FOUND }, 404);
        const division = (await loadDivision(db, team.divisionId)) as DivisionRow;
        const [counted] = await db
          .select({ count: sql<number>`count(*)` })
          .from(competitionTeamOfficial)
          .where(eq(competitionTeamOfficial.teamId, id));
        if ((counted?.count ?? 0) >= division.maxOfficials) {
          return c.json({ message: `เจ้าหน้าที่ทีมมีได้ไม่เกิน ${division.maxOfficials} คน` }, 409);
        }
        const underCap = sql`(select count(*) from ${competitionTeamOfficial} where ${competitionTeamOfficial.teamId} = ${id}) < (select ${sportDivision.maxOfficials} from ${sportDivision} where ${sportDivision.id} = ${team.divisionId})`;
        const officialId = crypto.randomUUID();
        const values = officialValues(input);
        try {
          await db.batch([
            abortUnless(
              db,
              c.var.user.id,
              and(sportAccessIsAsRead(c.var.user), underCap) ?? sql`0`,
            ),
            db.insert(competitionTeamOfficial).values({ id: officialId, teamId: id, ...values }),
            logCompetitionChange(db, c.var.user, "team", id, "official.add", {
              officialId,
              ...values,
            }),
          ]);
        } catch (error) {
          const kind = constraintError(error);
          if (kind === "stale" || kind === "foreign-key") return c.json({ message: STALE }, 409);
          throw error;
        }
        const [official] = await db
          .select()
          .from(competitionTeamOfficial)
          .where(eq(competitionTeamOfficial.id, officialId));
        return c.json({ official: official as NonNullable<typeof official> }, 201);
      },
    )

    .put(
      "/:id/officials/:officialId",
      allowSport("teams.manage"),
      validate("param", officialParam),
      validate("json", teamOfficialInput),
      async (c) => {
        const db = c.var.db;
        const { id, officialId } = c.req.valid("param");
        const values = officialValues(c.req.valid("json"));
        const where = and(
          eq(competitionTeamOfficial.id, officialId),
          eq(competitionTeamOfficial.teamId, id),
        );
        const [current] = await db.select().from(competitionTeamOfficial).where(where);
        if (!current) return c.json({ message: OFFICIAL_NOT_FOUND }, 404);
        try {
          await db.batch([
            abortUnless(
              db,
              c.var.user.id,
              and(
                sportAccessIsAsRead(c.var.user),
                sql`exists (select 1 from ${competitionTeamOfficial} where ${where})`,
              ) ?? sql`0`,
            ),
            db.update(competitionTeamOfficial).set(values).where(where),
            logCompetitionChange(db, c.var.user, "team", id, "official.update", {
              officialId,
              ...values,
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const [official] = await db.select().from(competitionTeamOfficial).where(where);
        return c.json({ official: official as NonNullable<typeof official> }, 200);
      },
    )

    .delete(
      "/:id/officials/:officialId",
      allowSport("teams.manage"),
      validate("param", officialParam),
      async (c) => {
        const db = c.var.db;
        const { id, officialId } = c.req.valid("param");
        const where = and(
          eq(competitionTeamOfficial.id, officialId),
          eq(competitionTeamOfficial.teamId, id),
        );
        const [current] = await db.select().from(competitionTeamOfficial).where(where);
        if (!current) return c.json({ message: OFFICIAL_NOT_FOUND }, 404);
        try {
          await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db.delete(competitionTeamOfficial).where(where),
            logCompetitionChange(db, c.var.user, "team", id, "official.remove", {
              officialId,
              name: current.name,
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        return c.json({ ok: true }, 200);
      },
    );

export type CompetitionTeamRoutes = ReturnType<typeof createCompetitionTeamRoutes>;
