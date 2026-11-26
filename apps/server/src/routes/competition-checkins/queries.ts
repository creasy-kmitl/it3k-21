// What the check-in routes read: matches with their division's check-in
// settings, each side's roster (the lineup if it has one, else the team) and
// who has checked in.
import type { Database } from "@it3k/db";
import {
  competitionLineup,
  competitionMatch,
  competitionMatchCheckin,
  competitionMatchParticipant,
  competitionTeam,
  competitionTeamMember,
  sport,
  sportDivision,
  sportRegistration,
  user,
  venue,
} from "@it3k/db/schema/index";
import { type SQL, and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { type CheckinWindow, checkinWindow, minPlayers, sideLabel } from "./rules";

/** Matches athletes may still check in to; live, finished and cancelled ones are past it. */
export const CHECKIN_STATUSES = ["scheduled", "checkin"] as const;

export type MatchRow = Awaited<ReturnType<typeof selectMatches>>[number];

/** Matches (not sub-matches) with their division's check-in settings and venue. */
export function selectMatches(db: Database, where?: SQL) {
  return db
    .select({
      id: competitionMatch.id,
      stageName: competitionMatch.stageName,
      roundNo: competitionMatch.roundNo,
      matchNo: competitionMatch.matchNo,
      startAt: competitionMatch.startAt,
      venueId: competitionMatch.venueId,
      venueName: venue.name,
      court: competitionMatch.court,
      status: competitionMatch.status,
      outcome: competitionMatch.outcome,
      scoreSeq: competitionMatch.scoreSeq,
      version: competitionMatch.version,
      divisionId: sportDivision.id,
      divisionName: sportDivision.name,
      sportName: sport.name,
      sportIcon: sport.icon,
      checkinMode: sportDivision.checkinMode,
      checkinOpensMin: sportDivision.checkinOpensMin,
      checkinClosesMin: sportDivision.checkinClosesMin,
      checkinMinPlayers: sportDivision.checkinMinPlayers,
      lineupStarters: sportDivision.lineupStarters,
      teamMinSize: sportDivision.teamMinSize,
    })
    .from(competitionMatch)
    .innerJoin(sportDivision, eq(sportDivision.id, competitionMatch.divisionId))
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .leftJoin(venue, eq(venue.id, competitionMatch.venueId))
    .where(and(isNull(competitionMatch.parentMatchId), where))
    .orderBy(asc(competitionMatch.startAt), asc(competitionMatch.matchNo));
}

export type SideRow = Awaited<ReturnType<typeof selectSides>>[number];

export function selectSides(db: Database, matchIds: string[]) {
  if (matchIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: competitionMatchParticipant.id,
      matchId: competitionMatchParticipant.matchId,
      slot: competitionMatchParticipant.slot,
      teamId: competitionMatchParticipant.teamId,
      label: competitionMatchParticipant.label,
      outcome: competitionMatchParticipant.outcome,
      teamName: competitionTeam.name,
      institution: competitionTeam.institution,
      seq: competitionTeam.seq,
    })
    .from(competitionMatchParticipant)
    .leftJoin(competitionTeam, eq(competitionTeam.id, competitionMatchParticipant.teamId))
    .where(inArray(competitionMatchParticipant.matchId, matchIds))
    .orderBy(asc(competitionMatchParticipant.matchId), asc(competitionMatchParticipant.slot));
}

/** Check-ins per side. */
async function checkinCounts(db: Database, matchIds: string[]) {
  if (matchIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ participantId: competitionMatchCheckin.participantId, n: count() })
    .from(competitionMatchCheckin)
    .where(inArray(competitionMatchCheckin.matchId, matchIds))
    .groupBy(competitionMatchCheckin.participantId);
  return new Map(rows.map((row) => [row.participantId, row.n]));
}

/** Lineup size per side; a side missing here has no lineup and plays its team. */
async function lineupCounts(db: Database, participantIds: string[]) {
  if (participantIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ participantId: competitionLineup.participantId, n: count() })
    .from(competitionLineup)
    .where(inArray(competitionLineup.participantId, participantIds))
    .groupBy(competitionLineup.participantId);
  return new Map(rows.map((row) => [row.participantId, row.n]));
}

async function teamCounts(db: Database, teamIds: string[]) {
  if (teamIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ teamId: competitionTeamMember.teamId, n: count() })
    .from(competitionTeamMember)
    .where(inArray(competitionTeamMember.teamId, teamIds))
    .groupBy(competitionTeamMember.teamId);
  return new Map(rows.map((row) => [row.teamId, row.n]));
}

export type SideSummary = {
  participantId: string;
  slot: number;
  teamId: string | null;
  label: string;
  outcome: SideRow["outcome"];
  checkedIn: number;
  // How many may check in: the lineup's size, else the team's.
  expected: number;
  usesLineup: boolean;
};

export type MatchSummary = Omit<
  MatchRow,
  "checkinMinPlayers" | "lineupStarters" | "teamMinSize" | "startAt"
> & {
  startAt: string | null;
  minPlayers: number;
  window:
    | (Omit<CheckinWindow, "opensAt" | "closesAt"> & { opensAt: string; closesAt: string })
    | null;
  sides: SideSummary[];
};

/** Each match with its window and every side's check-in count. */
export async function summarize(db: Database, matches: MatchRow[], now: number) {
  const ids = matches.map((match) => match.id);
  const sides = await selectSides(db, ids);
  const [counts, lineups, teams] = await Promise.all([
    checkinCounts(db, ids),
    lineupCounts(
      db,
      sides.map((side) => side.id),
    ),
    teamCounts(
      db,
      sides.flatMap((side) => (side.teamId ? [side.teamId] : [])),
    ),
  ]);
  return matches.map((match): MatchSummary => {
    const { checkinMinPlayers, lineupStarters, teamMinSize, startAt, ...rest } = match;
    const window = startAt ? checkinWindow(startAt.getTime(), match, now) : null;
    return {
      ...rest,
      startAt: startAt?.toISOString() ?? null,
      minPlayers: minPlayers({ checkinMinPlayers, lineupStarters, teamMinSize }),
      window: window
        ? {
            state: window.state,
            opensAt: new Date(window.opensAt).toISOString(),
            closesAt: new Date(window.closesAt).toISOString(),
          }
        : null,
      sides: sides
        .filter((side) => side.matchId === match.id)
        .map((side) => {
          const lineup = lineups.get(side.id);
          return {
            participantId: side.id,
            slot: side.slot,
            teamId: side.teamId,
            label: sideLabel(side),
            outcome: side.outcome,
            checkedIn: counts.get(side.id) ?? 0,
            expected: lineup ?? (side.teamId ? (teams.get(side.teamId) ?? 0) : 0),
            usesLineup: lineup !== undefined,
          };
        }),
    };
  });
}

export type RosterEntry = {
  userId: string;
  registrationId: string | null;
  displayName: string;
  shirtNumber: number | null;
  image: string | null;
  role: "starter" | "sub" | null;
  // False for someone checked in who has since left the lineup or team.
  listed: boolean;
  checkin: {
    method: "scan" | "manual";
    at: string;
    by: string | null;
  } | null;
};

/** Every side's roster with who has checked in, for the staff page. */
export async function rosters(db: Database, matchId: string, sides: SideRow[]) {
  const sideIds = sides.map((side) => side.id);
  const teamIds = sides.flatMap((side) => (side.teamId ? [side.teamId] : []));
  const checker = alias(user, "checker");
  const [lineup, members, checkins] = await Promise.all([
    sideIds.length === 0
      ? []
      : db
          .select({
            participantId: competitionLineup.participantId,
            registrationId: competitionLineup.registrationId,
            role: competitionLineup.role,
            userId: sportRegistration.userId,
            shirtNumber: sportRegistration.shirtNumber,
            displayName: competitionTeamMember.displayName,
            name: user.name,
            image: user.image,
          })
          .from(competitionLineup)
          .innerJoin(sportRegistration, eq(sportRegistration.id, competitionLineup.registrationId))
          .innerJoin(user, eq(user.id, sportRegistration.userId))
          .leftJoin(
            competitionTeamMember,
            eq(competitionTeamMember.registrationId, competitionLineup.registrationId),
          )
          .where(inArray(competitionLineup.participantId, sideIds))
          .orderBy(
            sql`case when ${competitionLineup.role} = 'starter' then 0 else 1 end`,
            asc(sportRegistration.shirtNumber),
          ),
    teamIds.length === 0
      ? []
      : db
          .select({
            teamId: competitionTeamMember.teamId,
            registrationId: competitionTeamMember.registrationId,
            userId: competitionTeamMember.userId,
            displayName: competitionTeamMember.displayName,
            shirtNumber: sportRegistration.shirtNumber,
            image: user.image,
          })
          .from(competitionTeamMember)
          .innerJoin(
            sportRegistration,
            eq(sportRegistration.id, competitionTeamMember.registrationId),
          )
          .innerJoin(user, eq(user.id, competitionTeamMember.userId))
          .where(inArray(competitionTeamMember.teamId, teamIds))
          .orderBy(asc(competitionTeamMember.sortOrder), asc(sportRegistration.shirtNumber)),
    db
      .select({
        participantId: competitionMatchCheckin.participantId,
        userId: competitionMatchCheckin.userId,
        method: competitionMatchCheckin.method,
        createdAt: competitionMatchCheckin.createdAt,
        by: checker.name,
        name: user.name,
        image: user.image,
      })
      .from(competitionMatchCheckin)
      .innerJoin(user, eq(user.id, competitionMatchCheckin.userId))
      .leftJoin(checker, eq(checker.id, competitionMatchCheckin.checkedInBy))
      .where(eq(competitionMatchCheckin.matchId, matchId))
      .orderBy(asc(competitionMatchCheckin.createdAt)),
  ]);

  const checkinOf = (participantId: string, userId: string) => {
    const row = checkins.find((c) => c.participantId === participantId && c.userId === userId);
    return row ? { method: row.method, at: row.createdAt.toISOString(), by: row.by } : null;
  };

  return new Map(
    sides.map((side) => {
      const fromLineup = lineup.filter((row) => row.participantId === side.id);
      const listed: RosterEntry[] =
        fromLineup.length > 0
          ? fromLineup.map((row) => ({
              userId: row.userId,
              registrationId: row.registrationId,
              displayName: row.displayName ?? row.name,
              shirtNumber: row.shirtNumber,
              image: row.image,
              role: row.role,
              listed: true,
              checkin: checkinOf(side.id, row.userId),
            }))
          : members
              .filter((row) => row.teamId === side.teamId)
              .map((row) => ({
                userId: row.userId,
                registrationId: row.registrationId,
                displayName: row.displayName,
                shirtNumber: row.shirtNumber,
                image: row.image,
                role: null,
                listed: true,
                checkin: checkinOf(side.id, row.userId),
              }));
      const strays: RosterEntry[] = checkins
        .filter(
          (row) =>
            row.participantId === side.id && !listed.some((entry) => entry.userId === row.userId),
        )
        .map((row) => ({
          userId: row.userId,
          registrationId: null,
          displayName: row.name,
          shirtNumber: null,
          image: row.image,
          role: null,
          listed: false,
          checkin: checkinOf(side.id, row.userId),
        }));
      return [side.id, [...listed, ...strays]] as const;
    }),
  );
}

/**
 * The sides of `matchIds` that `userId` may check in for: their lineup when
 * the side has one, else their team.
 */
export async function eligibleSides(db: Database, userId: string, matchIds: string[]) {
  if (matchIds.length === 0) return new Map<string, string>();
  const [byTeam, byLineup, sidesWithLineup] = await Promise.all([
    db
      .select({
        participantId: competitionMatchParticipant.id,
        matchId: competitionMatchParticipant.matchId,
      })
      .from(competitionMatchParticipant)
      .innerJoin(
        competitionTeamMember,
        eq(competitionTeamMember.teamId, competitionMatchParticipant.teamId),
      )
      .where(
        and(
          inArray(competitionMatchParticipant.matchId, matchIds),
          eq(competitionTeamMember.userId, userId),
        ),
      ),
    db
      .select({
        participantId: competitionLineup.participantId,
        matchId: competitionLineup.matchId,
      })
      .from(competitionLineup)
      .innerJoin(sportRegistration, eq(sportRegistration.id, competitionLineup.registrationId))
      .where(
        and(inArray(competitionLineup.matchId, matchIds), eq(sportRegistration.userId, userId)),
      ),
    db
      .selectDistinct({ participantId: competitionLineup.participantId })
      .from(competitionLineup)
      .where(inArray(competitionLineup.matchId, matchIds)),
  ]);
  const hasLineup = new Set(sidesWithLineup.map((row) => row.participantId));
  // match id -> the side they play for.
  const eligible = new Map<string, string>();
  for (const row of byLineup) eligible.set(row.matchId, row.participantId);
  for (const row of byTeam) {
    if (!hasLineup.has(row.participantId) && !eligible.has(row.matchId)) {
      eligible.set(row.matchId, row.participantId);
    }
  }
  return eligible;
}

/** The match ids among `matchIds` where `userId` plays for a side's team at all. */
export async function teamMatches(db: Database, userId: string, matchIds: string[]) {
  if (matchIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ matchId: competitionMatchParticipant.matchId })
    .from(competitionMatchParticipant)
    .innerJoin(
      competitionTeamMember,
      eq(competitionTeamMember.teamId, competitionMatchParticipant.teamId),
    )
    .where(
      and(
        inArray(competitionMatchParticipant.matchId, matchIds),
        eq(competitionTeamMember.userId, userId),
      ),
    );
  return new Set(rows.map((row) => row.matchId));
}

/** The athlete as the kiosk shows them: first name, shirt number and picture. */
export async function athleteFor(db: Database, userId: string, divisionId: string | null) {
  const [account] = await db
    .select({ id: user.id, name: user.name, image: user.image, institution: user.institution })
    .from(user)
    .where(eq(user.id, userId));
  if (!account) return null;
  const [registration] = divisionId
    ? await db
        .select({
          shirtNumber: sportRegistration.shirtNumber,
          institution: sportRegistration.institution,
          displayName: competitionTeamMember.displayName,
        })
        .from(sportRegistration)
        .leftJoin(
          competitionTeamMember,
          eq(competitionTeamMember.registrationId, sportRegistration.id),
        )
        .where(
          and(eq(sportRegistration.userId, userId), eq(sportRegistration.divisionId, divisionId)),
        )
    : [];
  return {
    userId: account.id,
    name: registration?.displayName ?? account.name,
    image: account.image,
    institution: registration?.institution ?? account.institution,
    shirtNumber: registration?.shirtNumber ?? null,
  };
}

export type Athlete = NonNullable<Awaited<ReturnType<typeof athleteFor>>>;

export async function checkinCount(db: Database, participantId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(competitionMatchCheckin)
    .where(eq(competitionMatchCheckin.participantId, participantId));
  return row?.n ?? 0;
}

/** SQL: the match still takes check-ins (not live, finished or cancelled). */
export function stillChecksIn(matchId: string): SQL {
  return sql`exists (select 1 from ${competitionMatch} where ${and(
    eq(competitionMatch.id, matchId),
    inArray(competitionMatch.status, [...CHECKIN_STATUSES]),
  )})`;
}

/** SQL: the side has fewer than `min` check-ins. */
export function sideShort(participantId: string, min: number): SQL {
  return sql`(select count(*) from ${competitionMatchCheckin} where ${eq(
    competitionMatchCheckin.participantId,
    participantId,
  )}) < ${min}`;
}
