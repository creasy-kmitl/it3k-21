// Round-robin schedules. Preview works the plan out and writes nothing;
// commit takes the same body and writes the groups and matches in one batch.
import type { Database } from "@it3k/db";
import {
  MIN_TEAMS_FOR_MEDALS,
  type RoundRobinInput,
  roundRobinInput,
} from "@it3k/db/competition-rules";
import { planRoundRobin } from "@it3k/db/round-robin";
import {
  competitionGroup,
  competitionGroupTeam,
  competitionMatch,
  competitionMatchParticipant,
  venue,
} from "@it3k/db/schema/index";
import { and, eq, inArray, max } from "drizzle-orm";
import { Hono } from "hono";

import { logCompetitionChange } from "../../competition/audit";
import { type CurrentUserEnv, constraintError } from "../../middleware/current-user";
import { allowSport } from "../../middleware/sport-permission";
import { validate } from "../../middleware/validation";
import {
  MESSAGES,
  checkTeams,
  checkVenues,
  chunks,
  divisionTeams,
  guards,
  loadDivision,
} from "./shared";

const GROUP_NAME_TWICE = "ตั้งชื่อสายซ้ำกัน";
const GROUP_EXISTS = "รอบนี้มีสายชื่อนี้อยู่แล้ว";

type Prepared =
  | { ok: false; status: 400 | 404; message: string }
  | { ok: true; plan: Awaited<ReturnType<typeof buildPlan>> };

async function buildPlan(db: Database, input: RoundRobinInput) {
  const teams = await divisionTeams(db, input.divisionId);
  const names = new Map(teams.map((team) => [team.id, team.name]));
  const [last] = await db
    .select({ matchNo: max(competitionMatch.matchNo) })
    .from(competitionMatch)
    .where(eq(competitionMatch.divisionId, input.divisionId));
  const venueIds = [
    ...new Set(input.courts.map((c) => c.venueId).filter((id): id is string => id !== null)),
  ];
  const venues =
    venueIds.length === 0
      ? []
      : await db
          .select({ id: venue.id, name: venue.name })
          .from(venue)
          .where(inArray(venue.id, venueIds));
  const venueNames = new Map(venues.map((v) => [v.id, v.name]));
  const firstMatchNo = (last?.matchNo ?? 0) + 1;
  const plan = planRoundRobin({ ...input, firstMatchNo });
  return {
    divisionId: input.divisionId,
    stageName: input.stageName,
    // Too few teams for medals: every match is a friendly.
    friendly: teams.length < MIN_TEAMS_FOR_MEDALS,
    firstMatchNo,
    slots: plan.slots,
    endsAt: plan.endsAt,
    groups: input.groups.map((group) => ({
      name: group.name,
      teams: group.teamIds.map((id) => ({ id, name: names.get(id) ?? "" })),
    })),
    matches: plan.matches.map((match) => ({
      ...match,
      homeName: names.get(match.homeTeamId) ?? "",
      awayName: names.get(match.awayTeamId) ?? "",
      venueName: match.venueId ? (venueNames.get(match.venueId) ?? null) : null,
    })),
  };
}

async function prepare(db: Database, input: RoundRobinInput): Promise<Prepared> {
  if (!(await loadDivision(db, input.divisionId))) {
    return { ok: false, status: 404, message: MESSAGES.divisionNotFound };
  }
  const groupNames = input.groups.map((g) => g.name);
  if (new Set(groupNames).size !== groupNames.length) {
    return { ok: false, status: 400, message: GROUP_NAME_TWICE };
  }
  const teamProblem = await checkTeams(
    db,
    input.divisionId,
    input.groups.flatMap((g) => g.teamIds),
  );
  if (teamProblem) return { ok: false, status: 400, message: teamProblem };
  const venueProblem = await checkVenues(
    db,
    input.courts.map((c) => c.venueId),
  );
  if (venueProblem) return { ok: false, status: 400, message: venueProblem };
  const [taken] = await db
    .select({ id: competitionGroup.id })
    .from(competitionGroup)
    .where(
      and(
        eq(competitionGroup.divisionId, input.divisionId),
        eq(competitionGroup.stageName, input.stageName),
        inArray(competitionGroup.name, groupNames),
      ),
    )
    .limit(1);
  if (taken) return { ok: false, status: 400, message: GROUP_EXISTS };
  return { ok: true, plan: await buildPlan(db, input) };
}

export const createScheduleRoutes = () =>
  new Hono<CurrentUserEnv>()
    .use(allowSport("matches.manage"))

    .post("/preview", validate("json", roundRobinInput), async (c) => {
      const prepared = await prepare(c.var.db, c.req.valid("json"));
      if (!prepared.ok) return c.json({ message: prepared.message }, prepared.status);
      return c.json({ plan: prepared.plan }, 200);
    })

    .post("/commit", validate("json", roundRobinInput), async (c) => {
      const db = c.var.db;
      const input = c.req.valid("json");
      const prepared = await prepare(db, input);
      if (!prepared.ok) return c.json({ message: prepared.message }, prepared.status);
      const { plan } = prepared;

      const groupIds = input.groups.map(() => crypto.randomUUID());
      const groups = input.groups.map((group, index) => ({
        id: groupIds[index] as string,
        divisionId: input.divisionId,
        stageName: input.stageName,
        name: group.name,
        sortOrder: index,
      }));
      const groupTeams = input.groups.flatMap((group, index) =>
        group.teamIds.map((teamId, seed) => ({
          groupId: groupIds[index] as string,
          teamId,
          seed: seed + 1,
        })),
      );
      const matches = plan.matches.map((match) => ({
        id: crypto.randomUUID(),
        divisionId: input.divisionId,
        groupId: groupIds[match.groupIndex] as string,
        stageName: input.stageName,
        roundNo: match.roundNo,
        matchNo: match.matchNo,
        startAt: new Date(match.startAt),
        venueId: match.venueId,
        court: match.court,
        friendly: plan.friendly,
        createdBy: c.var.user.id,
      }));
      const sides = plan.matches.flatMap((match, index) => {
        const matchId = (matches[index] as (typeof matches)[number]).id;
        return [
          { matchId, teamId: match.homeTeamId, slot: 1 },
          { matchId, teamId: match.awayTeamId, slot: 2 },
        ];
      });

      try {
        await db.batch([
          ...guards(db, c.var.user, {
            divisionId: input.divisionId,
            teamIds: input.groups.flatMap((g) => g.teamIds),
          }),
          ...chunks(groups, 8).map((rows) => db.insert(competitionGroup).values(rows)),
          ...chunks(groupTeams, 3).map((rows) => db.insert(competitionGroupTeam).values(rows)),
          ...chunks(matches, 17).map((rows) => db.insert(competitionMatch).values(rows)),
          ...chunks(sides, 5).map((rows) => db.insert(competitionMatchParticipant).values(rows)),
          ...groups.map((group, index) =>
            logCompetitionChange(db, c.var.user, "group", group.id, "schedule", {
              stageName: input.stageName,
              name: group.name,
              teamIds: input.groups[index]?.teamIds ?? [],
              matchIds: matches.filter((m) => m.groupId === group.id).map((m) => m.id),
              legs: input.legs,
            }),
          ),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        if (kind === "unique") return c.json({ message: GROUP_EXISTS }, 409);
        if (kind === "stale" || kind === "foreign-key") {
          return c.json({ message: MESSAGES.stale }, 409);
        }
        throw error;
      }
      return c.json({ groupIds, matchIds: matches.map((m) => m.id), plan }, 201);
    });
