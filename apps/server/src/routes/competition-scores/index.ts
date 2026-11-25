// Keeping score: score events, undo, starting and finishing a match, and
// results without play.
//
// A score is never written over. Each tap is an event with an id made on the
// scorer's phone, so a retry after a dropped connection changes nothing; undo
// voids an event. Every write replays the events with the match's engine and
// stores the result in the same batch, so public pages read it ready-made.
import type { Database } from "@it3k/db";
import {
  type MatchState,
  type ParticipantState,
  type ScoreEventRecord,
  finishMatchInput,
  matchResultInput,
  scoreEventsInput,
} from "@it3k/db/competition-rules";
import { INSTITUTIONS } from "@it3k/db/profile";
import { computeMatchState } from "@it3k/db/scoring/index";
import { eventProblem, outcomeFor, rankBy } from "@it3k/db/scoring/shared";
import type { SubMatchResult } from "@it3k/db/scoring/types";
import {
  competitionLineup,
  competitionMatch,
  competitionMatchParticipant,
  competitionScoreEvent,
  competitionTeam,
  competitionTeamMember,
  sport,
  sportRegistration,
} from "@it3k/db/schema/index";
import { type SQL, and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { type LoadedMatch, loadMatch, matchAsRead, scoreSeqAsRead } from "../../competition/access";
import { logCompetitionChange } from "../../competition/audit";
import { resultStatements } from "../../competition/results";
import {
  type CurrentUser,
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

const NOT_FOUND = "ไม่พบแมตช์นี้";
const STALE = "แมตช์นี้ถูกแก้ไขโดยคนอื่นแล้ว โหลดใหม่ก่อนบันทึก";
const CLOSED = "แมตช์นี้จบหรือถูกยกเลิกแล้ว";
// Writes that only add or void events retry on their own when another scorer
// wrote first: the client's ids keep the retry from counting twice.
const ATTEMPTS = 3;

const matchParam = z.strictObject({ matchId: z.string().min(1) });
const eventParam = z.strictObject({ matchId: z.string().min(1), eventId: z.string().min(1) });
const emptyBody = z.strictObject({});

// Statuses from which scoring may start; finished and cancelled are closed.
const STARTABLE = new Set(["scheduled", "checkin", "postponed", "live"]);

/** Every score event of a match, in seq order, as the engines read them. */
async function loadEvents(db: Database, matchId: string): Promise<ScoreEventRecord[]> {
  const rows = await db
    .select({
      id: competitionScoreEvent.id,
      seq: competitionScoreEvent.seq,
      payload: competitionScoreEvent.payload,
      voidedAt: competitionScoreEvent.voidedAt,
      createdAt: competitionScoreEvent.createdAt,
    })
    .from(competitionScoreEvent)
    .where(eq(competitionScoreEvent.matchId, matchId))
    .orderBy(asc(competitionScoreEvent.seq));
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    payload: row.payload,
    voided: row.voidedAt !== null,
    createdAt: row.createdAt.getTime(),
  }));
}

/**
 * Each finished sub-match's winner as a side of the parent, in order, for a
 * series that counts sub-matches. `override` stands in for one sub-match whose
 * result is being written in the same batch.
 */
async function subMatchResults(
  db: Database,
  parent: LoadedMatch,
  override?: { matchId: string; winnerTeamId: string | null },
): Promise<SubMatchResult[]> {
  if (parent.scoring.engine !== "series" || !parent.scoring.fromSubMatches) return [];
  const rows = await db
    .select({
      matchId: competitionMatch.id,
      status: competitionMatch.status,
      teamId: competitionMatchParticipant.teamId,
      outcome: competitionMatchParticipant.outcome,
    })
    .from(competitionMatch)
    .leftJoin(
      competitionMatchParticipant,
      eq(competitionMatchParticipant.matchId, competitionMatch.id),
    )
    .where(eq(competitionMatch.parentMatchId, parent.id))
    .orderBy(asc(competitionMatch.subOrder));
  const order: string[] = [];
  const winners = new Map<string, string | null>();
  for (const row of rows) {
    if (!winners.has(row.matchId)) {
      order.push(row.matchId);
      winners.set(row.matchId, null);
    }
    const won = row.outcome === "win" || row.outcome === "walkover_win";
    if (row.status === "finished" && won) winners.set(row.matchId, row.teamId);
  }
  if (override) winners.set(override.matchId, override.winnerTeamId);
  const sideOfTeam = new Map(parent.participants.map((p) => [p.teamId, p.id]));
  return order.map((id) => {
    const teamId = winners.get(id);
    return { winnerParticipantId: teamId ? (sideOfTeam.get(teamId) ?? null) : null };
  });
}

function compute(match: LoadedMatch, events: ScoreEventRecord[], subMatches: SubMatchResult[]) {
  return computeMatchState({
    config: match.scoring,
    participants: match.participants.map((p) => ({ id: p.id })),
    events,
    subMatches,
  });
}

/**
 * The parent's result again when this sub-match's winner changes, with the
 * check that the parent is still as read. Nothing for other matches.
 */
async function parentUpdate(
  db: Database,
  match: LoadedMatch,
  state: MatchState,
): Promise<{ asRead: SQL; statements: ReturnType<typeof resultStatements> } | null> {
  if (!match.parentMatchId) return null;
  const parent = await loadMatch(db, match.parentMatchId);
  if (parent?.scoring.engine !== "series" || !parent.scoring.fromSubMatches) return null;
  const winner = state.participants.find(
    (p) => p.outcome === "win" || p.outcome === "walkover_win",
  );
  const winnerTeamId =
    match.participants.find((p) => p.id === winner?.participantId)?.teamId ?? null;
  const subMatches = await subMatchResults(db, parent, { matchId: match.id, winnerTeamId });
  const parentState = compute(parent, await loadEvents(db, parent.id), subMatches);
  return {
    asRead: matchAsRead(parent.id, parent.version),
    statements: resultStatements(db, { matchId: parent.id, state: parentState }),
  };
}

/** Ranks and outcomes when staff finish a match the engine has not decided. */
function forcedResult(state: MatchState): MatchState {
  const ranked = state.participants.some((p) => p.rank !== null);
  const ranks = ranked
    ? new Map(state.participants.map((p) => [p, p.rank]))
    : rankBy(
        state.participants,
        (a, b) => (b.score ?? 0) - (a.score ?? 0),
        (p) => p.score !== null,
      );
  const allRanks = state.participants.map((p) => ranks.get(p) ?? null);
  return {
    ...state,
    participants: state.participants.map((p) => {
      const rank = ranks.get(p) ?? null;
      return { ...p, rank, outcome: outcomeFor(rank, allRanks) };
    }),
  };
}

const teamNumber = (institution: string) =>
  INSTITUTIONS.find((item) => item.id === institution)?.short ?? institution;

/** What the scorer and the match page read: the match, its sides, events and state. */
async function scoreboard(db: Database, user: CurrentUser, match: LoadedMatch) {
  const events = await loadEvents(db, match.id);
  const state = compute(match, events, await subMatchResults(db, match));
  const teamIds = match.participants.flatMap((p) => (p.teamId ? [p.teamId] : []));

  const [sportRow] = await db
    .select({ name: sport.name, icon: sport.icon })
    .from(sport)
    .where(eq(sport.id, match.division.sportId));
  const teams = teamIds.length
    ? await db.select().from(competitionTeam).where(inArray(competitionTeam.id, teamIds))
    : [];
  // A team's number shows only when its institution has several in the division.
  const siblings = await db
    .select({ institution: competitionTeam.institution, teams: count() })
    .from(competitionTeam)
    .where(eq(competitionTeam.divisionId, match.divisionId))
    .groupBy(competitionTeam.institution);
  const members = teamIds.length
    ? await db
        .select({
          teamId: competitionTeamMember.teamId,
          registrationId: competitionTeamMember.registrationId,
          displayName: competitionTeamMember.displayName,
          shirtNumber: sportRegistration.shirtNumber,
        })
        .from(competitionTeamMember)
        .innerJoin(
          sportRegistration,
          eq(sportRegistration.id, competitionTeamMember.registrationId),
        )
        .where(inArray(competitionTeamMember.teamId, teamIds))
        .orderBy(asc(competitionTeamMember.sortOrder), asc(sportRegistration.shirtNumber))
    : [];
  const lineup = await db
    .select({
      participantId: competitionLineup.participantId,
      registrationId: competitionLineup.registrationId,
      role: competitionLineup.role,
    })
    .from(competitionLineup)
    .where(eq(competitionLineup.matchId, match.id));

  const sides = match.participants.map((side) => {
    const team = teams.find((item) => item.id === side.teamId);
    const several = (siblings.find((s) => s.institution === team?.institution)?.teams ?? 0) > 1;
    const name = team
      ? (team.name ?? `${teamNumber(team.institution)}${several ? ` ${team.seq}` : ""}`)
      : (side.label ?? "รอผล");
    const roster = members.filter((m) => m.teamId === side.teamId);
    const picked = lineup.filter((row) => row.participantId === side.id);
    // The lineup when there is one, else the whole team.
    const players = picked.length
      ? roster.flatMap((m) => {
          const row = picked.find((p) => p.registrationId === m.registrationId);
          return row ? [{ ...m, role: row.role }] : [];
        })
      : roster.map((m) => ({ ...m, role: null }));
    return {
      id: side.id,
      slot: side.slot,
      teamId: side.teamId,
      institution: team?.institution ?? null,
      name,
      score: side.score,
      detail: side.detail,
      resultValue: side.resultValue,
      rank: side.rank,
      outcome: side.outcome,
      players: players.map(({ registrationId, displayName, shirtNumber, role }) => ({
        registrationId,
        displayName,
        shirtNumber,
        role,
      })),
    };
  });

  return {
    match: {
      id: match.id,
      status: match.status,
      outcome: match.outcome,
      stageName: match.stageName,
      roundNo: match.roundNo,
      matchNo: match.matchNo,
      court: match.court,
      friendly: match.friendly,
      parentMatchId: match.parentMatchId,
      startAt: match.startAt?.getTime() ?? null,
      startedAt: match.startedAt?.getTime() ?? null,
      finishedAt: match.finishedAt?.getTime() ?? null,
      version: match.version,
      scoreSeq: match.scoreSeq,
      division: { id: match.division.id, code: match.division.code, name: match.division.name },
      sport: {
        id: match.division.sportId,
        name: sportRow?.name ?? "",
        icon: sportRow?.icon ?? null,
      },
    },
    scoring: match.scoring,
    sides,
    events,
    state,
    canScore: canSport(user, "matches.score"),
  };
}

export type Scoreboard = Awaited<ReturnType<typeof scoreboard>>;

export const createCompetitionScoreRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(allowSport("competition.read"))

    .get("/:matchId", validate("param", matchParam), async (c) => {
      const match = await loadMatch(c.var.db, c.req.valid("param").matchId);
      if (!match) return c.json({ message: NOT_FOUND }, 404);
      return c.json(await scoreboard(c.var.db, c.var.user, match), 200);
    })

    // Adds events; ids already taken for this match are skipped, so the
    // offline queue can send the same batch again.
    .post(
      "/:matchId/events",
      allowSport("matches.score"),
      validate("param", matchParam),
      validate("json", scoreEventsInput),
      async (c) => {
        const db = c.var.db;
        const user = c.var.user;
        const { matchId } = c.req.valid("param");
        const input = c.req.valid("json").events;
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          const match = await loadMatch(db, matchId);
          if (!match) return c.json({ message: NOT_FOUND }, 404);
          const events = await loadEvents(db, matchId);
          const known = new Set(events.map((event) => event.id));
          const fresh = input.filter(
            (event, index) =>
              !known.has(event.id) && input.findIndex((e) => e.id === event.id) === index,
          );
          if (fresh.length === 0) return c.json(await scoreboard(db, user, match), 200);
          if (!STARTABLE.has(match.status)) return c.json({ message: CLOSED }, 409);

          const elsewhere = await db
            .select({ id: competitionScoreEvent.id })
            .from(competitionScoreEvent)
            .where(
              inArray(
                competitionScoreEvent.id,
                fresh.map((event) => event.id),
              ),
            );
          if (elsewhere.length) return c.json({ message: "รหัสรายการซ้ำกับแมตช์อื่น" }, 409);
          const sideIds = match.participants.map((p) => p.id);
          for (const event of fresh) {
            const problem = eventProblem(match.scoring, event.payload, sideIds);
            if (problem) return c.json({ message: problem, eventId: event.id }, 400);
          }

          const now = new Date();
          const records: ScoreEventRecord[] = fresh.map((event, index) => ({
            id: event.id,
            seq: match.scoreSeq + index + 1,
            payload: event.payload,
            voided: false,
            createdAt: now.getTime(),
          }));
          const state = compute(match, [...events, ...records], await subMatchResults(db, match));
          const starting = match.status !== "live";
          try {
            await db.batch([
              abortUnless(
                db,
                user.id,
                and(
                  sportAccessIsAsRead(user),
                  scoreSeqAsRead(matchId, match.scoreSeq),
                  matchAsRead(matchId, match.version),
                ) ?? sql`0`,
              ),
              db.insert(competitionScoreEvent).values(
                fresh.map((event, index) => ({
                  id: event.id,
                  matchId,
                  seq: match.scoreSeq + index + 1,
                  type: event.payload.type,
                  participantId:
                    "participantId" in event.payload ? event.payload.participantId : null,
                  registrationId:
                    "registrationId" in event.payload ? event.payload.registrationId : null,
                  payload: event.payload,
                  createdBy: user.id,
                  clientCreatedAt: new Date(event.clientAt),
                  createdAt: now,
                })),
              ),
              ...resultStatements(db, {
                matchId,
                state,
                scoreSeq: match.scoreSeq + fresh.length,
                ...(starting ? { status: "live", startedAt: match.startedAt ?? now } : {}),
              }),
              ...(starting ? [logCompetitionChange(db, user, "match", matchId, "start")] : []),
            ]);
          } catch (error) {
            const kind = constraintError(error);
            if (kind === "stale" || kind === "unique") continue;
            throw error;
          }
          const saved = await loadMatch(db, matchId);
          return c.json(await scoreboard(db, user, saved as LoadedMatch), 200);
        }
        return c.json({ message: STALE }, 409);
      },
    )

    // Undo: the event stays in the log, voided, and the score is replayed without it.
    .post(
      "/:matchId/events/:eventId/void",
      allowSport("matches.score"),
      validate("param", eventParam),
      validate("json", emptyBody),
      async (c) => {
        const db = c.var.db;
        const user = c.var.user;
        const { matchId, eventId } = c.req.valid("param");
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          const match = await loadMatch(db, matchId);
          if (!match) return c.json({ message: NOT_FOUND }, 404);
          const events = await loadEvents(db, matchId);
          const target = events.find((event) => event.id === eventId);
          if (!target) return c.json({ message: "ไม่พบรายการนี้" }, 404);
          if (target.voided) return c.json(await scoreboard(db, user, match), 200);
          if (match.status !== "live") return c.json({ message: CLOSED }, 409);

          const replay = events.map((event) =>
            event.id === eventId ? { ...event, voided: true } : event,
          );
          const state = compute(match, replay, await subMatchResults(db, match));
          try {
            await db.batch([
              abortUnless(
                db,
                user.id,
                and(
                  sportAccessIsAsRead(user),
                  scoreSeqAsRead(matchId, match.scoreSeq),
                  matchAsRead(matchId, match.version),
                ) ?? sql`0`,
              ),
              db
                .update(competitionScoreEvent)
                .set({ voidedAt: new Date(), voidedBy: user.id })
                .where(
                  and(
                    eq(competitionScoreEvent.id, eventId),
                    eq(competitionScoreEvent.matchId, matchId),
                    isNull(competitionScoreEvent.voidedAt),
                  ),
                ),
              ...resultStatements(db, { matchId, state }),
            ]);
          } catch (error) {
            if (constraintError(error) === "stale") continue;
            throw error;
          }
          const saved = await loadMatch(db, matchId);
          return c.json(await scoreboard(db, user, saved as LoadedMatch), 200);
        }
        return c.json({ message: STALE }, 409);
      },
    )

    .post(
      "/:matchId/start",
      allowSport("matches.score"),
      validate("param", matchParam),
      validate("json", emptyBody),
      async (c) => {
        const db = c.var.db;
        const user = c.var.user;
        const { matchId } = c.req.valid("param");
        const match = await loadMatch(db, matchId);
        if (!match) return c.json({ message: NOT_FOUND }, 404);
        if (match.status === "live") return c.json(await scoreboard(db, user, match), 200);
        if (!STARTABLE.has(match.status)) return c.json({ message: CLOSED }, 409);
        const state = compute(
          match,
          await loadEvents(db, matchId),
          await subMatchResults(db, match),
        );
        try {
          await db.batch([
            abortUnless(
              db,
              user.id,
              and(sportAccessIsAsRead(user), matchAsRead(matchId, match.version)) ?? sql`0`,
            ),
            ...resultStatements(db, { matchId, state, status: "live", startedAt: new Date() }),
            logCompetitionChange(db, user, "match", matchId, "start"),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const saved = await loadMatch(db, matchId);
        return c.json(await scoreboard(db, user, saved as LoadedMatch), 200);
      },
    )

    // Ends a match as played. The engine must see a winner (or a draw where
    // one may stand) unless staff force it, in which case scores rank the sides.
    .post(
      "/:matchId/finish",
      allowSport("matches.score"),
      validate("param", matchParam),
      validate("json", finishMatchInput),
      async (c) => {
        const db = c.var.db;
        const user = c.var.user;
        const { matchId } = c.req.valid("param");
        const { force, version } = c.req.valid("json");
        const match = await loadMatch(db, matchId);
        if (!match) return c.json({ message: NOT_FOUND }, 404);
        if (match.version !== version) return c.json({ message: STALE }, 409);
        if (match.status === "finished" || match.status === "cancelled") {
          return c.json({ message: CLOSED }, 409);
        }
        const computed = compute(
          match,
          await loadEvents(db, matchId),
          await subMatchResults(db, match),
        );
        if (!computed.decided && !force) {
          return c.json({ message: "ตามกติกายังไม่มีผลแพ้ชนะ ยืนยันจบแมตช์เองได้ถ้าจำเป็น" }, 409);
        }
        const state = computed.decided ? computed : forcedResult(computed);
        const now = new Date();
        const parent = await parentUpdate(db, match, state);
        try {
          await db.batch([
            abortUnless(
              db,
              user.id,
              and(sportAccessIsAsRead(user), matchAsRead(matchId, version), parent?.asRead) ??
                sql`0`,
            ),
            ...resultStatements(db, {
              matchId,
              state,
              status: "finished",
              outcome: "played",
              startedAt: match.startedAt ?? now,
              finishedAt: now,
            }),
            ...(parent?.statements ?? []),
            logCompetitionChange(db, user, "match", matchId, "finish", {
              force: force && !computed.decided,
              scores: state.participants.map((p) => [p.participantId, p.score]),
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const saved = await loadMatch(db, matchId);
        return c.json(await scoreboard(db, user, saved as LoadedMatch), 200);
      },
    )

    // A result without play, or one typed in by hand: walkover, forfeit, no
    // contest, or ranks staff set. Also corrects a finished match's result.
    .post(
      "/:matchId/result",
      allowSport("matches.score"),
      validate("param", matchParam),
      validate("json", matchResultInput),
      async (c) => {
        const db = c.var.db;
        const user = c.var.user;
        const { matchId } = c.req.valid("param");
        const { outcome, ranks, version } = c.req.valid("json");
        const match = await loadMatch(db, matchId);
        if (!match) return c.json({ message: NOT_FOUND }, 404);
        if (match.version !== version) return c.json({ message: STALE }, 409);
        if (match.status === "cancelled") return c.json({ message: CLOSED }, 409);
        const sideIds = match.participants.map((p) => p.id);
        const given = new Set(ranks.map((r) => r.participantId));
        if (
          given.size !== ranks.length ||
          given.size !== sideIds.length ||
          !sideIds.every((id) => given.has(id))
        ) {
          return c.json({ message: "ระบุผลให้ครบทุกฝ่ายในแมตช์ ฝ่ายละครั้ง" }, 400);
        }
        const computed = compute(
          match,
          await loadEvents(db, matchId),
          await subMatchResults(db, match),
        );
        const state: MatchState = {
          ...computed,
          participants: computed.participants.map((p): ParticipantState => {
            const entry = ranks.find((r) => r.participantId === p.participantId);
            return { ...p, rank: entry?.rank ?? null, outcome: entry?.outcome ?? null };
          }),
        };
        const now = new Date();
        const parent = await parentUpdate(db, match, state);
        try {
          await db.batch([
            abortUnless(
              db,
              user.id,
              and(sportAccessIsAsRead(user), matchAsRead(matchId, version), parent?.asRead) ??
                sql`0`,
            ),
            ...resultStatements(db, {
              matchId,
              state,
              status: "finished",
              outcome,
              finishedAt: now,
            }),
            ...(parent?.statements ?? []),
            logCompetitionChange(db, user, "match", matchId, "result", { outcome, ranks }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const saved = await loadMatch(db, matchId);
        return c.json(await scoreboard(db, user, saved as LoadedMatch), 200);
      },
    );

export type CompetitionScoreRoutes = ReturnType<typeof createCompetitionScoreRoutes>;
