// How the match pages read matches: a filtered list grouped later by day, and
// one match with everything around it.
import type { Database } from "@it3k/db";
import { MATCH_STATUSES, type SideSource } from "@it3k/db/competition-rules";
import type { Institution } from "@it3k/db/profile";
import {
  competitionGroup,
  competitionMatch,
  competitionMatchImage,
  competitionMatchParticipant,
  competitionMatchReferee,
  competitionTeam,
  sport,
  sportDivision,
  venue,
} from "@it3k/db/schema/index";
import { type SQL, and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { chunks, teamName } from "./shared";

export const listQuery = z.strictObject({
  sportId: z.string().min(1).optional(),
  divisionId: z.string().min(1).optional(),
  venueId: z.string().min(1).optional(),
  status: z.enum(MATCH_STATUSES).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

const matchColumns = {
  id: competitionMatch.id,
  divisionId: competitionMatch.divisionId,
  divisionName: sportDivision.name,
  sportId: sport.id,
  sportName: sport.name,
  sportIcon: sport.icon,
  parentMatchId: competitionMatch.parentMatchId,
  subOrder: competitionMatch.subOrder,
  groupId: competitionMatch.groupId,
  groupName: competitionGroup.name,
  stageName: competitionMatch.stageName,
  roundNo: competitionMatch.roundNo,
  matchNo: competitionMatch.matchNo,
  startAt: competitionMatch.startAt,
  venueId: competitionMatch.venueId,
  venueName: venue.name,
  court: competitionMatch.court,
  status: competitionMatch.status,
  outcome: competitionMatch.outcome,
  friendly: competitionMatch.friendly,
  scoreSeq: competitionMatch.scoreSeq,
  coverImageUrl: competitionMatch.coverImageUrl,
  notes: competitionMatch.notes,
  scoringConfig: competitionMatch.scoringConfig,
  version: competitionMatch.version,
};

function selectMatches(db: Database, where: SQL | undefined) {
  return db
    .select(matchColumns)
    .from(competitionMatch)
    .innerJoin(sportDivision, eq(sportDivision.id, competitionMatch.divisionId))
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .leftJoin(competitionGroup, eq(competitionGroup.id, competitionMatch.groupId))
    .leftJoin(venue, eq(venue.id, competitionMatch.venueId))
    .where(where)
    .orderBy(
      // Unscheduled matches last.
      sql`${competitionMatch.startAt} is null`,
      asc(competitionMatch.startAt),
      asc(competitionMatch.matchNo),
      asc(competitionMatch.subOrder),
    );
}

/** Each match's sides in slot order, with team names. */
async function sidesOf(db: Database, matchIds: string[]) {
  const sides = new Map<string, Side[]>();
  for (const part of chunks(matchIds, 1)) {
    const rows = await db
      .select({
        id: competitionMatchParticipant.id,
        matchId: competitionMatchParticipant.matchId,
        slot: competitionMatchParticipant.slot,
        teamId: competitionMatchParticipant.teamId,
        label: competitionMatchParticipant.label,
        sourceMatchId: competitionMatchParticipant.sourceMatchId,
        sourceResult: competitionMatchParticipant.sourceResult,
        score: competitionMatchParticipant.score,
        detail: competitionMatchParticipant.detail,
        resultValue: competitionMatchParticipant.resultValue,
        rank: competitionMatchParticipant.rank,
        outcome: competitionMatchParticipant.outcome,
        teamName: competitionTeam.name,
        institution: competitionTeam.institution,
        seq: competitionTeam.seq,
        maxTeamsPerInstitution: sportDivision.maxTeamsPerInstitution,
      })
      .from(competitionMatchParticipant)
      .leftJoin(competitionTeam, eq(competitionTeam.id, competitionMatchParticipant.teamId))
      .leftJoin(sportDivision, eq(sportDivision.id, competitionTeam.divisionId))
      .where(inArray(competitionMatchParticipant.matchId, part))
      .orderBy(asc(competitionMatchParticipant.slot));
    for (const row of rows) {
      const { teamName: ownName, institution, seq, maxTeamsPerInstitution, ...side } = row;
      const name =
        institution && seq !== null
          ? teamName({
              name: ownName,
              institution,
              seq,
              maxTeamsPerInstitution: maxTeamsPerInstitution ?? 1,
            })
          : (side.label ?? "");
      sides.set(row.matchId, [
        ...(sides.get(row.matchId) ?? []),
        { ...side, name, institution: institution ?? null },
      ]);
    }
  }
  return sides;
}

type Side = {
  id: string;
  matchId: string;
  slot: number;
  teamId: string | null;
  label: string | null;
  /** The knockout match whose winner or loser takes this side. */
  sourceMatchId: string | null;
  sourceResult: SideSource | null;
  name: string;
  /** The team's institution, for its logo; null for a placeholder side. */
  institution: Institution | null;
  score: number | null;
  detail: (typeof competitionMatchParticipant.$inferSelect)["detail"];
  resultValue: number | null;
  rank: number | null;
  outcome: (typeof competitionMatchParticipant.$inferSelect)["outcome"];
};

/** Top-level matches that pass the filters, each with its sides. */
export async function listMatches(db: Database, query: ListQuery) {
  const rows = await selectMatches(
    db,
    and(
      isNull(competitionMatch.parentMatchId),
      query.sportId ? eq(sport.id, query.sportId) : undefined,
      query.divisionId ? eq(competitionMatch.divisionId, query.divisionId) : undefined,
      query.venueId ? eq(competitionMatch.venueId, query.venueId) : undefined,
      query.status ? eq(competitionMatch.status, query.status) : undefined,
    ),
  );
  const sides = await sidesOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    startAt: row.startAt?.getTime() ?? null,
    participants: sides.get(row.id) ?? [],
  }));
}

/** One match with its division, sides, sub-matches, referees and images; null if none. */
export async function matchDetail(db: Database, id: string) {
  const [row] = await selectMatches(db, eq(competitionMatch.id, id));
  if (!row) return null;
  const [division] = await db
    .select({
      format: sportDivision.format,
      lineupStarters: sportDivision.lineupStarters,
      lineupMaxSubs: sportDivision.lineupMaxSubs,
      awardsMedals: sportDivision.awardsMedals,
    })
    .from(sportDivision)
    .where(eq(sportDivision.id, row.divisionId));
  const subMatches = await selectMatches(db, eq(competitionMatch.parentMatchId, id));
  const sides = await sidesOf(db, [id, ...subMatches.map((sub) => sub.id)]);
  const referees = await db
    .select({
      id: competitionMatchReferee.id,
      name: competitionMatchReferee.name,
      role: competitionMatchReferee.role,
      sortOrder: competitionMatchReferee.sortOrder,
    })
    .from(competitionMatchReferee)
    .where(eq(competitionMatchReferee.matchId, id))
    .orderBy(asc(competitionMatchReferee.sortOrder), asc(competitionMatchReferee.createdAt));
  const images = await db
    .select({
      id: competitionMatchImage.id,
      url: competitionMatchImage.url,
      caption: competitionMatchImage.caption,
      isCover: competitionMatchImage.isCover,
      sortOrder: competitionMatchImage.sortOrder,
    })
    .from(competitionMatchImage)
    .where(eq(competitionMatchImage.matchId, id))
    .orderBy(asc(competitionMatchImage.sortOrder), asc(competitionMatchImage.createdAt));
  return {
    ...row,
    startAt: row.startAt?.getTime() ?? null,
    division: division ?? null,
    participants: sides.get(id) ?? [],
    subMatches: subMatches.map((sub) => ({
      ...sub,
      startAt: sub.startAt?.getTime() ?? null,
      participants: sides.get(sub.id) ?? [],
    })),
    referees,
    images,
  };
}
