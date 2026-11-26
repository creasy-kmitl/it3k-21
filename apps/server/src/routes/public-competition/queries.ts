// Reads for the public competition pages. Every column is picked by hand: no
// email, account id, registration id or other personal field ever leaves here.
// Athletes are their first name (copied onto the team member) and shirt number.
//
// Lists never bind one parameter per match (D1 allows 100 per query): the
// sides are read with the same filter as their matches, through a join.
import type { Database } from "@it3k/db";
import type {
  ClockState,
  MatchPhase,
  ParticipantDetail,
  TimelineEntry,
} from "@it3k/db/competition-rules";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { resolveScoringConfig } from "@it3k/db/scoring/presets";
import {
  competitionGroup,
  competitionMatch,
  competitionMatchParticipant,
  competitionTeam,
  sport,
  sportDivision,
  venue,
} from "@it3k/db/schema/index";
import { type SQL, asc, eq, isNull, sql } from "drizzle-orm";

const SHORT_NAMES = new Map<string, string>(INSTITUTIONS.map((i) => [i.id, i.short]));

/** How many teams the team's institution has in its division. */
const siblingTeams = sql<number>`(select count(*) from ${competitionTeam} as sibling where sibling.division_id = ${competitionTeam.divisionId} and sibling.institution = ${competitionTeam.institution})`;

/** A team's public name: its own, else the institution's short name, numbered when it has several. */
export function teamName(team: {
  name: string | null;
  institution: string;
  seq: number;
  siblings: number;
}) {
  if (team.name) return team.name;
  const short = SHORT_NAMES.get(team.institution) ?? team.institution;
  return team.siblings > 1 || team.seq > 1 ? `${short} ${team.seq}` : short;
}

export const teamColumns = {
  teamId: competitionTeam.id,
  teamName: competitionTeam.name,
  institution: competitionTeam.institution,
  seq: competitionTeam.seq,
  siblings: siblingTeams,
};

export type TeamRow = {
  teamId: string | null;
  teamName: string | null;
  institution: Institution | null;
  seq: number | null;
  siblings: number | null;
};

export function publicTeam(row: TeamRow) {
  if (!row.teamId || !row.institution) return null;
  return {
    id: row.teamId,
    name: teamName({
      name: row.teamName,
      institution: row.institution,
      seq: row.seq ?? 1,
      siblings: row.siblings ?? 1,
    }),
    institution: row.institution,
  };
}

const matchColumns = {
  id: competitionMatch.id,
  parentMatchId: competitionMatch.parentMatchId,
  subOrder: competitionMatch.subOrder,
  stageName: competitionMatch.stageName,
  roundNo: competitionMatch.roundNo,
  matchNo: competitionMatch.matchNo,
  startAt: competitionMatch.startAt,
  court: competitionMatch.court,
  status: competitionMatch.status,
  outcome: competitionMatch.outcome,
  friendly: competitionMatch.friendly,
  matchScoring: competitionMatch.scoringConfig,
  liveState: competitionMatch.liveState,
  coverImageUrl: competitionMatch.coverImageUrl,
  startedAt: competitionMatch.startedAt,
  finishedAt: competitionMatch.finishedAt,
  divisionId: sportDivision.id,
  divisionCode: sportDivision.code,
  divisionName: sportDivision.name,
  divisionFormat: sportDivision.format,
  divisionScoring: sportDivision.scoringConfig,
  sportId: sport.id,
  sportName: sport.name,
  sportIcon: sport.icon,
  venueId: venue.id,
  venueName: venue.name,
  groupId: competitionGroup.id,
  groupName: competitionGroup.name,
};

const sideColumns = {
  matchId: competitionMatchParticipant.matchId,
  id: competitionMatchParticipant.id,
  slot: competitionMatchParticipant.slot,
  label: competitionMatchParticipant.label,
  sourceMatchId: competitionMatchParticipant.sourceMatchId,
  sourceResult: competitionMatchParticipant.sourceResult,
  score: competitionMatchParticipant.score,
  detail: competitionMatchParticipant.detail,
  resultValue: competitionMatchParticipant.resultValue,
  rank: competitionMatchParticipant.rank,
  outcome: competitionMatchParticipant.outcome,
  ...teamColumns,
};

type SideRow = Awaited<ReturnType<typeof selectSides>>[number];

function matchQuery(db: Database) {
  return db
    .select(matchColumns)
    .from(competitionMatch)
    .innerJoin(sportDivision, eq(sportDivision.id, competitionMatch.divisionId))
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .leftJoin(venue, eq(venue.id, competitionMatch.venueId))
    .leftJoin(competitionGroup, eq(competitionGroup.id, competitionMatch.groupId));
}

type MatchRow = Awaited<ReturnType<typeof matchQuery>>[number];

function selectSides(db: Database, where: SQL | undefined) {
  return db
    .select(sideColumns)
    .from(competitionMatchParticipant)
    .innerJoin(competitionMatch, eq(competitionMatch.id, competitionMatchParticipant.matchId))
    .innerJoin(sportDivision, eq(sportDivision.id, competitionMatch.divisionId))
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .leftJoin(venue, eq(venue.id, competitionMatch.venueId))
    .leftJoin(competitionGroup, eq(competitionGroup.id, competitionMatch.groupId))
    .leftJoin(competitionTeam, eq(competitionTeam.id, competitionMatchParticipant.teamId))
    .where(where)
    .orderBy(asc(competitionMatchParticipant.slot));
}

function publicSide(row: SideRow) {
  const team = publicTeam(row);
  return {
    id: row.id,
    slot: row.slot,
    name: team?.name ?? row.label ?? "",
    team,
    // The knockout match this side waits on, for the bracket view.
    sourceMatchId: row.sourceMatchId,
    sourceResult: row.sourceResult,
    score: row.score,
    detail: row.detail as ParticipantDetail | null,
    resultValue: row.resultValue,
    rank: row.rank,
    outcome: row.outcome,
  };
}

export type PublicSide = ReturnType<typeof publicSide>;

/** The live part of `live_state` the engines keep; anything else in it stays private. */
function publicLive(liveState: Record<string, unknown> | null) {
  if (!liveState) return null;
  return {
    period: typeof liveState.period === "number" ? liveState.period : 1,
    phase: (liveState.phase as MatchPhase | undefined) ?? "regular",
    decided: liveState.decided === true,
    clock: (liveState.clock as ClockState | null | undefined) ?? null,
  };
}

function publicMatch(row: MatchRow, sides: PublicSide[]) {
  const division = { id: row.divisionId, code: row.divisionCode, name: row.divisionName };
  return {
    id: row.id,
    parentMatchId: row.parentMatchId,
    subOrder: row.subOrder,
    sport: { id: row.sportId, name: row.sportName, icon: row.sportIcon },
    division,
    stageName: row.stageName,
    group: row.groupId ? { id: row.groupId, name: row.groupName ?? "" } : null,
    roundNo: row.roundNo,
    matchNo: row.matchNo,
    startAt: row.startAt?.getTime() ?? null,
    startedAt: row.startedAt?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
    venue: row.venueId ? { id: row.venueId, name: row.venueName ?? "" } : null,
    court: row.court,
    status: row.status,
    outcome: row.outcome,
    friendly: row.friendly,
    coverImageUrl: row.coverImageUrl,
    scoring: resolveScoringConfig(
      { scoringConfig: row.matchScoring },
      {
        code: division.code,
        format: row.divisionFormat,
        scoringConfig: row.divisionScoring,
      },
    ),
    live: publicLive(row.liveState),
    sides,
  };
}

export type PublicMatch = ReturnType<typeof publicMatch>;

/** Matches (with their sides) that pass `where`, in `orderBy` order. */
export async function selectMatches(
  db: Database,
  where: SQL | undefined,
  orderBy: SQL[],
  limit: number,
): Promise<PublicMatch[]> {
  const [rows, sides] = await Promise.all([
    matchQuery(db)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit),
    selectSides(db, where),
  ]);
  const byMatch = new Map<string, PublicSide[]>();
  for (const side of sides) {
    const list = byMatch.get(side.matchId) ?? [];
    list.push(publicSide(side));
    byMatch.set(side.matchId, list);
  }
  return rows.map((row) => publicMatch(row, byMatch.get(row.id) ?? []));
}

/** Only whole matches: a table tennis team rubber shows inside its parent. */
export const topLevel = isNull(competitionMatch.parentMatchId);

/** Search over what a list item shows: sport, division, stage, group, venue and sides. */
export function matchesQuery(match: PublicMatch, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    match.sport.name,
    match.division.name,
    match.division.code,
    match.stageName,
    match.group?.name,
    match.venue?.name,
    match.court,
    match.matchNo === null ? null : `M${match.matchNo}`,
    ...match.sides.map((side) => side.name),
    ...match.sides.map((side) =>
      side.team ? INSTITUTIONS.find((i) => i.id === side.team?.institution)?.name : null,
    ),
  ];
  return haystack.some((text) => !!text && text.toLowerCase().includes(needle));
}

/** The options the filters offer: what the scheduled matches cover. */
export async function selectFilterOptions(db: Database) {
  // The same joins as the match list, so a filter's options match its results.
  const rows = await db
    .select({
      sportId: sport.id,
      sportName: sport.name,
      sportIcon: sport.icon,
      divisionId: sportDivision.id,
      divisionName: sportDivision.name,
      venueId: venue.id,
      venueName: venue.name,
      startAt: competitionMatch.startAt,
    })
    .from(competitionMatch)
    .innerJoin(sportDivision, eq(sportDivision.id, competitionMatch.divisionId))
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .leftJoin(venue, eq(venue.id, competitionMatch.venueId))
    .where(topLevel)
    .orderBy(
      asc(sport.sortOrder),
      asc(sport.name),
      asc(sportDivision.sortOrder),
      asc(sportDivision.name),
    );

  const sports = new Map<
    string,
    { id: string; name: string; icon: string; divisions: Map<string, string> }
  >();
  const venues = new Map<string, string>();
  const days = new Set<string>();
  for (const row of rows) {
    const entry = sports.get(row.sportId) ?? {
      id: row.sportId,
      name: row.sportName,
      icon: row.sportIcon,
      divisions: new Map(),
    };
    entry.divisions.set(row.divisionId, row.divisionName);
    sports.set(row.sportId, entry);
    if (row.venueId) venues.set(row.venueId, row.venueName ?? "");
    if (row.startAt) days.add(bangkokDay(row.startAt.getTime()));
  }
  return {
    sports: [...sports.values()].map((entry) => ({
      id: entry.id,
      name: entry.name,
      icon: entry.icon,
      divisions: [...entry.divisions].map(([id, name]) => ({ id, name })),
    })),
    venues: [...venues]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    days: [...days].sort(),
  };
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of the Bangkok day `ms` falls on (UTC+07:00 all year). */
export function bangkokDay(ms: number) {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instants a Bangkok day starts and ends. */
export function bangkokDayRange(day: string) {
  const start = Date.parse(`${day}T00:00:00Z`) - BANGKOK_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/** The public timeline: the engine's lines, with athletes as name and shirt number. */
export function publicTimeline(
  liveState: Record<string, unknown> | null,
  athletes: Map<string, { name: string; shirtNumber: number | null }>,
) {
  const entries = Array.isArray(liveState?.timeline) ? (liveState.timeline as TimelineEntry[]) : [];
  return entries.map((entry) => {
    const athlete = entry.registrationId ? athletes.get(entry.registrationId) : undefined;
    return {
      id: entry.eventId,
      at: entry.at,
      period: entry.period,
      sideId: entry.participantId,
      text: entry.text,
      athlete: athlete ?? null,
    };
  });
}
