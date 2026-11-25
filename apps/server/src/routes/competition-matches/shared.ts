// Reads and checks the match routes share: team names, a division's teams,
// and the SQL that rechecks them inside a write batch.
import type { Database } from "@it3k/db";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { competitionTeam, sport, sportDivision, venue } from "@it3k/db/schema/index";
import { type SQL, and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { CurrentUser } from "../../middleware/current-user";
import { abortUnless } from "../../middleware/current-user";
import { sportAccessIsAsRead } from "../../policies/sports";

export const MESSAGES = {
  matchNotFound: "ไม่พบแมตช์นี้",
  divisionNotFound: "ไม่พบประเภทนี้",
  groupNotFound: "ไม่พบสายนี้",
  stale: "ข้อมูลถูกแก้ไขโดยคนอื่นแล้ว โหลดใหม่ก่อนบันทึก",
  teamNotInDivision: "มีทีมที่ไม่ได้อยู่ในประเภทนี้",
  teamTwice: "เลือกทีมซ้ำกัน",
  venueNotFound: "ไม่พบสถานที่ที่เลือก",
} as const;

/** D1 binds at most 100 parameters per statement; multi-row inserts stay under it. */
const MAX_PARAMS = 100;

export function chunks<T>(list: readonly T[], paramsPerRow: number): T[][] {
  const size = Math.max(1, Math.floor(MAX_PARAMS / paramsPerRow));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const idParam = z.strictObject({ id: z.string().min(1) });
export const divisionParam = z.strictObject({ divisionId: z.string().min(1) });
export const versionQuery = z.strictObject({ version: z.coerce.number().int().min(0) });

const SHORT_NAMES = new Map<string, string>(INSTITUTIONS.map((i) => [i.id, i.short]));

/** A team as pages show it: its own name, else its institution's short name and number. */
export function teamName(team: {
  name: string | null;
  institution: Institution;
  seq: number;
  maxTeamsPerInstitution: number;
}) {
  if (team.name) return team.name;
  const short = SHORT_NAMES.get(team.institution) ?? team.institution;
  return team.maxTeamsPerInstitution > 1 || team.seq > 1 ? `${short} ${team.seq}` : short;
}

export const teamColumns = {
  id: competitionTeam.id,
  divisionId: competitionTeam.divisionId,
  institution: competitionTeam.institution,
  seq: competitionTeam.seq,
  name: competitionTeam.name,
  maxTeamsPerInstitution: sportDivision.maxTeamsPerInstitution,
};

/** A division's teams with display names, in institution order. */
export async function divisionTeams(db: Database, divisionId: string) {
  const rows = await db
    .select(teamColumns)
    .from(competitionTeam)
    .innerJoin(sportDivision, eq(sportDivision.id, competitionTeam.divisionId))
    .where(eq(competitionTeam.divisionId, divisionId))
    .orderBy(asc(competitionTeam.institution), asc(competitionTeam.seq));
  const order = INSTITUTIONS.map((i) => i.id as string);
  return rows
    .map((row) => ({
      id: row.id,
      institution: row.institution,
      seq: row.seq,
      name: teamName(row),
    }))
    .toSorted(
      (a, b) => order.indexOf(a.institution) - order.indexOf(b.institution) || a.seq - b.seq,
    );
}

/** The division with its sport, or undefined. */
export async function loadDivision(db: Database, divisionId: string) {
  const [row] = await db
    .select({
      id: sportDivision.id,
      name: sportDivision.name,
      code: sportDivision.code,
      format: sportDivision.format,
      awardsMedals: sportDivision.awardsMedals,
      lineupStarters: sportDivision.lineupStarters,
      lineupMaxSubs: sportDivision.lineupMaxSubs,
      sportId: sport.id,
      sportName: sport.name,
      sportIcon: sport.icon,
    })
    .from(sportDivision)
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .where(eq(sportDivision.id, divisionId));
  return row;
}

/** Null when every team is in the division and none is listed twice; else why not. */
export async function checkTeams(db: Database, divisionId: string, teamIds: readonly string[]) {
  if (new Set(teamIds).size !== teamIds.length) return MESSAGES.teamTwice;
  if (teamIds.length === 0) return null;
  const found = new Set<string>();
  for (const part of chunks(teamIds, 1)) {
    const rows = await db
      .select({ id: competitionTeam.id })
      .from(competitionTeam)
      .where(and(eq(competitionTeam.divisionId, divisionId), inArray(competitionTeam.id, part)));
    for (const row of rows) found.add(row.id);
  }
  return found.size === teamIds.length ? null : MESSAGES.teamNotInDivision;
}

/** Null when every venue exists; else why not. */
export async function checkVenues(db: Database, venueIds: readonly (string | null)[]) {
  const ids = [...new Set(venueIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return null;
  const rows = await db.select({ id: venue.id }).from(venue).where(inArray(venue.id, ids));
  return rows.length === ids.length ? null : MESSAGES.venueNotFound;
}

/** SQL: every one of these teams is still in the division. */
function teamsStillIn(divisionId: string, teamIds: readonly string[]): SQL {
  return sql`(select count(*) from ${competitionTeam} where ${and(
    eq(competitionTeam.divisionId, divisionId),
    inArray(competitionTeam.id, [...teamIds]),
  )}) = ${teamIds.length}`;
}

/**
 * Guards for a write batch: the actor's sport rights are as read, `extra`
 * holds, and every listed team is still in the division. Long team lists are
 * split over several guards to stay under D1's parameter limit.
 */
export function guards(
  db: Database,
  actor: CurrentUser,
  options: { extra?: SQL; divisionId?: string; teamIds?: readonly string[] } = {},
) {
  const first = abortUnless(
    db,
    actor.id,
    and(sportAccessIsAsRead(actor), options.extra ?? sql`1`) ?? sql`0`,
  );
  const teamIds = options.teamIds ?? [];
  const divisionId = options.divisionId;
  const rest =
    divisionId && teamIds.length > 0
      ? chunks(teamIds, 2).map((part) => abortUnless(db, actor.id, teamsStillIn(divisionId, part)))
      : [];
  return [first, ...rest] as const;
}
