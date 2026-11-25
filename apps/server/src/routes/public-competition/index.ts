// Public competition pages, read without signing in: matches, the live board,
// standings and medals. Athletes appear by first name and shirt number only;
// no email, account id or registration id is ever sent (queries.ts).
//
// Every answer is the same for everyone, so the edge caches it for a few
// seconds: a crowd on the live board costs one read per URL per 5 s.
import { MATCH_STATUSES } from "@it3k/db/competition-rules";
import { computeMedals, divisionCountsForMedals } from "@it3k/db/medals";
import { INSTITUTION_IDS } from "@it3k/db/profile";
import {
  competitionGroup,
  competitionGroupTeam,
  competitionLineup,
  competitionMatch,
  competitionMatchImage,
  competitionMatchParticipant,
  competitionMatchReferee,
  competitionPlacement,
  competitionTeam,
  competitionTeamMember,
  competitionTeamOfficial,
  sport,
  sportDivision,
  sportRegistration,
  sportRule,
} from "@it3k/db/schema/index";
import { computeStandings } from "@it3k/db/standings";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { RouteDeps } from "../../middleware/current-user";
import { edgeCache } from "../../middleware/edge-cache";
import { validate } from "../../middleware/validation";
import {
  bangkokDayRange,
  matchesQuery,
  publicTeam,
  publicTimeline,
  selectFilterOptions,
  selectMatches,
  teamColumns,
  topLevel,
} from "./queries";

const NOT_FOUND = "ไม่พบแมตช์นี้";

/** More than any day's programme; the list is one page. */
export const MATCH_LIST_LIMIT = 500;
export const UPCOMING_LIMIT = 8;
export const RECENT_LIMIT = 4;
/** A match that was due this long ago but has not started still counts as coming up. */
const LATE_GRACE_MS = 2 * 60 * 60 * 1000;

const optionalId = z.string().trim().min(1).max(100).optional();

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sportId: optionalId,
  divisionId: optionalId,
  venueId: optionalId,
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(MATCH_STATUSES).optional(),
});

const idParam = z.strictObject({ id: z.string().min(1).max(100) });
const standingsQuery = z.object({ divisionId: optionalId });

const byStart = [
  sql`${competitionMatch.startAt} is null`,
  asc(competitionMatch.startAt),
  asc(competitionMatch.matchNo),
  asc(competitionMatch.id),
];

export const createPublicCompetitionRoutes = (deps: Pick<RouteDeps, "getDb">) =>
  new Hono()
    .use(edgeCache())

    // What the filters offer: sports and divisions, venues and days with matches.
    .get("/filters", async (c) => c.json(await selectFilterOptions(deps.getDb()), 200))

    // Whole matches, soonest first, narrowed by the filters and a search.
    .get("/matches", validate("query", listQuery), async (c) => {
      const filters = c.req.valid("query");
      const day = filters.day ? bangkokDayRange(filters.day) : null;
      const where = and(
        topLevel,
        filters.sportId ? eq(sportDivision.sportId, filters.sportId) : undefined,
        filters.divisionId ? eq(competitionMatch.divisionId, filters.divisionId) : undefined,
        filters.venueId ? eq(competitionMatch.venueId, filters.venueId) : undefined,
        filters.status ? eq(competitionMatch.status, filters.status) : undefined,
        day ? gte(competitionMatch.startAt, day.start) : undefined,
        day ? lt(competitionMatch.startAt, day.end) : undefined,
      );
      const matches = await selectMatches(deps.getDb(), where, byStart, MATCH_LIST_LIMIT);
      const q = filters.q ?? "";
      return c.json({ items: matches.filter((match) => matchesQuery(match, q)) }, 200);
    })

    // The live board: what is on now, what comes next, and what just ended.
    .get("/live", async (c) => {
      const db = deps.getDb();
      const now = Date.now();
      const [live, upcoming, recent] = await Promise.all([
        selectMatches(db, and(topLevel, eq(competitionMatch.status, "live")), byStart, 100),
        selectMatches(
          db,
          and(
            topLevel,
            inArray(competitionMatch.status, ["scheduled", "checkin"]),
            gte(competitionMatch.startAt, new Date(now - LATE_GRACE_MS)),
          ),
          byStart,
          UPCOMING_LIMIT,
        ),
        selectMatches(
          db,
          and(topLevel, eq(competitionMatch.status, "finished")),
          [desc(competitionMatch.finishedAt), desc(competitionMatch.id)],
          RECENT_LIMIT,
        ),
      ]);
      return c.json({ now, live, upcoming, recent }, 200);
    })

    // One match with everything its page shows.
    .get("/matches/:id", validate("param", idParam), async (c) => {
      const db = deps.getDb();
      const { id } = c.req.valid("param");
      const [match] = await selectMatches(db, eq(competitionMatch.id, id), byStart, 1);
      if (!match) return c.json({ message: NOT_FOUND }, 404);

      const teamIds = match.sides.flatMap((side) => (side.team ? [side.team.id] : []));
      const [members, lineup, officials, referees, images, rules, subMatches, state] =
        await Promise.all([
          teamIds.length === 0
            ? []
            : db
                .select({
                  teamId: competitionTeamMember.teamId,
                  registrationId: competitionTeamMember.registrationId,
                  name: competitionTeamMember.displayName,
                  shirtNumber: sportRegistration.shirtNumber,
                })
                .from(competitionTeamMember)
                .innerJoin(
                  sportRegistration,
                  eq(sportRegistration.id, competitionTeamMember.registrationId),
                )
                .where(inArray(competitionTeamMember.teamId, teamIds))
                .orderBy(
                  asc(competitionTeamMember.sortOrder),
                  asc(sportRegistration.shirtNumber),
                  asc(competitionTeamMember.displayName),
                ),
          db
            .select({
              participantId: competitionLineup.participantId,
              registrationId: competitionLineup.registrationId,
              role: competitionLineup.role,
            })
            .from(competitionLineup)
            .where(eq(competitionLineup.matchId, id)),
          teamIds.length === 0
            ? []
            : db
                .select({
                  teamId: competitionTeamOfficial.teamId,
                  name: competitionTeamOfficial.name,
                  position: competitionTeamOfficial.position,
                  description: competitionTeamOfficial.description,
                  photoUrl: competitionTeamOfficial.photoUrl,
                })
                .from(competitionTeamOfficial)
                .where(inArray(competitionTeamOfficial.teamId, teamIds))
                .orderBy(asc(competitionTeamOfficial.sortOrder), asc(competitionTeamOfficial.name)),
          db
            .select({ name: competitionMatchReferee.name, role: competitionMatchReferee.role })
            .from(competitionMatchReferee)
            .where(eq(competitionMatchReferee.matchId, id))
            .orderBy(asc(competitionMatchReferee.sortOrder), asc(competitionMatchReferee.name)),
          db
            .select({
              id: competitionMatchImage.id,
              url: competitionMatchImage.url,
              caption: competitionMatchImage.caption,
              isCover: competitionMatchImage.isCover,
            })
            .from(competitionMatchImage)
            .where(eq(competitionMatchImage.matchId, id))
            .orderBy(desc(competitionMatchImage.isCover), asc(competitionMatchImage.sortOrder)),
          // The division's own rules, else its sport's.
          db
            .select({ divisionId: sportRule.divisionId, markdown: sportRule.markdown })
            .from(sportRule)
            .where(
              or(
                eq(sportRule.divisionId, match.division.id),
                eq(sportRule.sportId, match.sport.id),
              ),
            ),
          selectMatches(
            db,
            eq(competitionMatch.parentMatchId, id),
            [asc(competitionMatch.subOrder)],
            50,
          ),
          db
            .select({ liveState: competitionMatch.liveState })
            .from(competitionMatch)
            .where(eq(competitionMatch.id, id)),
        ]);

      const roles = new Map(
        lineup.map((row) => [`${row.participantId}:${row.registrationId}`, row.role]),
      );
      const hasLineup = new Set(lineup.map((row) => row.participantId));
      const athletes = new Map(
        members.map((row) => [
          row.registrationId,
          { name: row.name, shirtNumber: row.shirtNumber },
        ]),
      );
      const sides = match.sides.map((side) => {
        const teamId = side.team?.id;
        const roster = members
          .filter((row) => row.teamId === teamId)
          .map((row) => ({
            name: row.name,
            shirtNumber: row.shirtNumber,
            role: roles.get(`${side.id}:${row.registrationId}`) ?? null,
          }))
          // With a lineup, only the athletes named in it play this match.
          .filter((row) => !hasLineup.has(side.id) || row.role !== null);
        return {
          ...side,
          members: roster,
          officials: officials
            .filter((row) => row.teamId === teamId)
            .map(({ teamId: _teamId, ...official }) => official),
        };
      });
      const rule =
        rules.find((row) => row.divisionId === match.division.id) ??
        rules.find((row) => row.divisionId === null);

      return c.json(
        {
          ...match,
          sides,
          referees,
          images,
          rules: rule?.markdown ?? null,
          timeline: publicTimeline(state[0]?.liveState ?? null, athletes),
          subMatches,
        },
        200,
      );
    })

    // Group tables of every division that keeps one.
    .get("/standings", validate("query", standingsQuery), async (c) => {
      const db = deps.getDb();
      const { divisionId } = c.req.valid("query");
      const kept = and(
        isNotNull(sportDivision.standingsConfig),
        divisionId ? eq(sportDivision.id, divisionId) : undefined,
      );
      const [groups, groupTeams, games] = await Promise.all([
        db
          .select({
            id: competitionGroup.id,
            stageName: competitionGroup.stageName,
            name: competitionGroup.name,
            divisionId: sportDivision.id,
            divisionName: sportDivision.name,
            config: sportDivision.standingsConfig,
            sportId: sport.id,
            sportName: sport.name,
            sportIcon: sport.icon,
          })
          .from(competitionGroup)
          .innerJoin(sportDivision, eq(sportDivision.id, competitionGroup.divisionId))
          .innerJoin(sport, eq(sport.id, sportDivision.sportId))
          .where(kept)
          .orderBy(
            asc(sport.sortOrder),
            asc(sport.name),
            asc(sportDivision.sortOrder),
            asc(sportDivision.name),
            asc(competitionGroup.stageName),
            asc(competitionGroup.sortOrder),
            asc(competitionGroup.name),
          ),
        db
          .select({
            groupId: competitionGroupTeam.groupId,
            seed: competitionGroupTeam.seed,
            ...teamColumns,
          })
          .from(competitionGroupTeam)
          .innerJoin(competitionGroup, eq(competitionGroup.id, competitionGroupTeam.groupId))
          .innerJoin(sportDivision, eq(sportDivision.id, competitionGroup.divisionId))
          .innerJoin(competitionTeam, eq(competitionTeam.id, competitionGroupTeam.teamId))
          .where(kept)
          .orderBy(
            sql`${competitionGroupTeam.seed} is null`,
            asc(competitionGroupTeam.seed),
            asc(competitionTeam.institution),
            asc(competitionTeam.seq),
          ),
        db
          .select({
            matchId: competitionMatch.id,
            groupId: competitionMatch.groupId,
            status: competitionMatch.status,
            outcome: competitionMatch.outcome,
            friendly: competitionMatch.friendly,
            teamId: competitionMatchParticipant.teamId,
            score: competitionMatchParticipant.score,
            detail: competitionMatchParticipant.detail,
            sideOutcome: competitionMatchParticipant.outcome,
          })
          .from(competitionMatchParticipant)
          .innerJoin(competitionMatch, eq(competitionMatch.id, competitionMatchParticipant.matchId))
          .innerJoin(sportDivision, eq(sportDivision.id, competitionMatch.divisionId))
          .where(
            and(
              kept,
              topLevel,
              isNotNull(competitionMatch.groupId),
              eq(competitionMatch.status, "finished"),
            ),
          )
          .orderBy(asc(competitionMatchParticipant.slot)),
      ]);

      type Game = Parameters<typeof computeStandings>[0]["matches"][number];
      const gamesByGroup = new Map<string, Map<string, Game>>();
      for (const row of games) {
        if (!row.groupId) continue;
        const group = gamesByGroup.get(row.groupId) ?? new Map<string, Game>();
        const game = group.get(row.matchId) ?? {
          status: row.status,
          outcome: row.outcome,
          friendly: row.friendly,
          sides: [],
        };
        game.sides.push({
          teamId: row.teamId,
          score: row.score,
          detail: row.detail,
          outcome: row.sideOutcome,
        });
        group.set(row.matchId, game);
        gamesByGroup.set(row.groupId, group);
      }

      const divisions: {
        id: string;
        name: string;
        sport: { id: string; name: string; icon: string };
        points: { win: number; draw: number; loss: number; forfeit: number };
        tiebreaks: string[];
        groups: {
          id: string;
          stageName: string;
          name: string;
          rows: (ReturnType<typeof computeStandings>[number] & {
            team: NonNullable<ReturnType<typeof publicTeam>>;
          })[];
        }[];
      }[] = [];
      for (const group of groups) {
        if (!group.config) continue;
        let division = divisions.at(-1);
        if (division?.id !== group.divisionId) {
          division = {
            id: group.divisionId,
            name: group.divisionName,
            sport: { id: group.sportId, name: group.sportName, icon: group.sportIcon },
            points: {
              win: group.config.win,
              draw: group.config.draw,
              loss: group.config.loss,
              forfeit: group.config.forfeit,
            },
            tiebreaks: group.config.tiebreaks,
            groups: [],
          };
          divisions.push(division);
        }
        const teams = new Map(
          groupTeams
            .filter((row) => row.groupId === group.id)
            .flatMap((row) => {
              const team = publicTeam(row);
              return team ? [[team.id, team] as const] : [];
            }),
        );
        const rows = computeStandings({
          teamIds: [...teams.keys()],
          matches: [...(gamesByGroup.get(group.id)?.values() ?? [])],
          config: group.config,
        });
        division.groups.push({
          id: group.id,
          stageName: group.stageName,
          name: group.name,
          rows: rows.map((row) => ({
            ...row,
            team: teams.get(row.teamId) as NonNullable<ReturnType<typeof publicTeam>>,
          })),
        });
      }
      return c.json({ divisions }, 200);
    })

    // The overall medal table, and each division's final places.
    .get("/medals", async (c) => {
      const db = deps.getDb();
      const teamCount = sql<number>`(select count(*) from ${competitionTeam} where ${competitionTeam.divisionId} = ${sportDivision.id})`;
      const [divisions, placements] = await Promise.all([
        db
          .select({
            id: sportDivision.id,
            name: sportDivision.name,
            awardsMedals: sportDivision.awardsMedals,
            teamCount,
            sportName: sport.name,
            sportIcon: sport.icon,
          })
          .from(sportDivision)
          .innerJoin(sport, eq(sport.id, sportDivision.sportId))
          .orderBy(
            asc(sport.sortOrder),
            asc(sport.name),
            asc(sportDivision.sortOrder),
            asc(sportDivision.name),
          ),
        db
          .select({
            divisionId: competitionPlacement.divisionId,
            place: competitionPlacement.place,
            ...teamColumns,
          })
          .from(competitionPlacement)
          .innerJoin(competitionTeam, eq(competitionTeam.id, competitionPlacement.teamId))
          .orderBy(asc(competitionPlacement.place), asc(competitionTeam.institution)),
      ]);

      const rows = computeMedals({
        divisions,
        placements: placements.map((row) => ({
          divisionId: row.divisionId,
          institution: row.institution,
          place: row.place,
        })),
        institutions: INSTITUTION_IDS,
      });
      const results = divisions.flatMap((division) => {
        const places = placements
          .filter((row) => row.divisionId === division.id)
          .flatMap((row) => {
            const team = publicTeam(row);
            return team ? [{ place: row.place, team }] : [];
          });
        if (places.length === 0) return [];
        return [
          {
            id: division.id,
            name: division.name,
            sport: { name: division.sportName, icon: division.sportIcon },
            counted: divisionCountsForMedals(division),
            places,
          },
        ];
      });
      return c.json({ rows, divisions: results }, 200);
    });

export type PublicCompetitionRoutes = ReturnType<typeof createPublicCompetitionRoutes>;
