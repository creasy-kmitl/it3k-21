// Checking athletes in to one match at a time, at the match's kiosk or by
// hand (esports, via Discord), and forfeiting sides that did not turn up.
//
// A match's kiosk lives on its staff page. An athlete shows their six-digit
// sport check-in code on /me (or the account barcode) and is checked in to
// that match while its window is open: from the division's `checkinOpensMin`
// minutes before the start until `checkinClosesMin` minutes before it. They
// must be in their side's lineup when it has one, else in the team. Staff may
// tick athletes in or out by hand at any time before the match starts, and
// once check-in has closed, forfeit a side short of the minimum.
import { loadMatch, matchAsRead } from "../../competition/access";
import { logCompetitionChange } from "../../competition/audit";
import { resultStatements } from "../../competition/results";
import {
  matchCheckinManualInput,
  matchCheckinScanInput,
  parseSportScan,
} from "@it3k/db/competition-rules";
import type { MatchState } from "@it3k/db/competition-rules";
import { athlete, competitionMatch, competitionMatchCheckin } from "@it3k/db/schema/index";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

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
import {
  CHECKIN_STATUSES,
  athleteFor,
  checkinCount,
  eligibleSides,
  rosters,
  selectMatches,
  selectSides,
  sideShort,
  stillChecksIn,
  summarize,
  teamMatches,
} from "./queries";
import { checkinWindow, minPlayers } from "./rules";

const NOT_FOUND = "ไม่พบแมตช์นี้";
const STALE = "ข้อมูลแมตช์เปลี่ยนไปแล้ว โหลดใหม่แล้วลองอีกครั้ง";
const CLOSED_MATCH = "แมตช์นี้เริ่มแข่ง จบ หรือยกเลิกแล้ว เช็คอินไม่ได้";
const TICKET = "นี่คือ QR ตั๋วกิจกรรม ใช้รหัสเช็คอินกีฬาในหน้าโปรไฟล์ของนักกีฬาเพื่อรายงานตัวแข่งขัน";
const UNKNOWN = "ไม่พบนักกีฬาของรหัสนี้";
const MANUAL = "ประเภทนี้รายงานตัวกับเจ้าหน้าที่ ไม่ใช้ kiosk";
const NOT_IN_MATCH = "นักกีฬาคนนี้ไม่ได้อยู่ในทีมของแมตช์นี้";
const NOT_IN_LINEUP = "ไม่อยู่ในรายชื่อผู้เล่นของแมตช์นี้ ติดต่อผู้จัดการทีม";
const TOO_EARLY = "ยังไม่เปิดรายงานตัว";
const CLOSED = "ปิดรายงานตัวแล้ว ติดต่อเจ้าหน้าที่สนาม";
const NOT_ELIGIBLE = "นักกีฬาคนนี้ไม่อยู่ในรายชื่อของฝั่งนี้";
const OTHER_SIDE = "นักกีฬาคนนี้เช็คอินกับอีกฝั่งไปแล้ว";
const NO_CHECKIN = "ไม่พบการเช็คอินนี้";

const checkinOf = (matchId: string, userId: string) =>
  and(eq(competitionMatchCheckin.matchId, matchId), eq(competitionMatchCheckin.userId, userId));

const matchParam = z.strictObject({ matchId: z.string().min(1) });
const checkinParam = z.strictObject({ matchId: z.string().min(1), userId: z.string().min(1) });
const forfeitInput = z.strictObject({
  participantIds: z.array(z.string().min(1)).min(1).max(16),
  version: z.number().int().min(0),
});

export type ScanFailureCode =
  | "ticket"
  | "unknown"
  | "manual"
  | "match-closed"
  | "not-in-match"
  | "not-in-lineup"
  | "too-early"
  | "closed";

export const createCompetitionCheckinRoutes = (deps: RouteDeps & { now?: () => number }) => {
  const now = deps.now ?? Date.now;
  return (
    new Hono<CurrentUserEnv>()
      .use(requireJsonPosts)
      .use(requireUser(deps))
      .use(requireMember)
      .use(allowSport("matches.checkin"))

      // One match: every side's roster with who has checked in.
      .get("/matches/:matchId", validate("param", matchParam), async (c) => {
        const db = c.var.db;
        const at = now();
        const { matchId } = c.req.valid("param");
        const [found] = await selectMatches(db, eq(competitionMatch.id, matchId));
        if (!found) return c.json({ message: NOT_FOUND }, 404);
        const [match] = await summarize(db, [found], at);
        const summary = match as NonNullable<typeof match>;
        const people = await rosters(db, matchId, await selectSides(db, [matchId]));
        const mayForfeit =
          canSport(c.var.user, "matches.manage") || canSport(c.var.user, "matches.score");
        const open = (CHECKIN_STATUSES as readonly string[]).includes(found.status);
        return c.json(
          {
            match: {
              ...summary,
              sides: summary.sides.map((side) => ({
                ...side,
                roster: people.get(side.participantId) ?? [],
              })),
            },
            canCheckIn: open,
            canForfeit:
              mayForfeit && open && found.scoreSeq === 0 && summary.window?.state === "closed",
          },
          200,
        );
      })

      // The match's kiosk: a six-digit check-in code (or an account id from
      // the barcode on /me) checks the athlete in while the window is open.
      .post(
        "/matches/:matchId/scan",
        validate("param", matchParam),
        validate("json", matchCheckinScanInput),
        async (c) => {
          const db = c.var.db;
          const actor = c.var.user;
          const at = now();
          const { matchId } = c.req.valid("param");
          const fail = (
            code: ScanFailureCode,
            message: string,
            status: 400 | 404 | 409,
            extra: Record<string, unknown> = {},
          ) => c.json({ code, message, ...extra }, status);

          const [found] = await selectMatches(db, eq(competitionMatch.id, matchId));
          if (!found) return c.json({ message: NOT_FOUND }, 404);
          const scanned = parseSportScan(c.req.valid("json").code);
          if ("ticketCode" in scanned) return fail("ticket", TICKET, 400);
          const userId =
            "checkinCode" in scanned
              ? (
                  await db
                    .select({ userId: athlete.userId })
                    .from(athlete)
                    .where(eq(athlete.checkinCode, scanned.checkinCode))
                ).at(0)?.userId
              : scanned.userId;
          const known = userId ? await athleteFor(db, userId, found.divisionId) : null;
          if (!userId || !known) return fail("unknown", UNKNOWN, 404);

          const [summary] = await summarize(db, [found], at);
          const match = summary as NonNullable<typeof summary>;
          const told = { person: known, match };
          if (found.checkinMode !== "kiosk") return fail("manual", MANUAL, 409, told);
          if (!(CHECKIN_STATUSES as readonly string[]).includes(found.status)) {
            return fail("match-closed", CLOSED_MATCH, 409, told);
          }
          const [eligible, onTeam] = await Promise.all([
            eligibleSides(db, userId, [matchId]),
            teamMatches(db, userId, [matchId]),
          ]);
          const participantId = eligible.get(matchId);
          if (!participantId) {
            return onTeam.has(matchId)
              ? fail("not-in-lineup", NOT_IN_LINEUP, 409, told)
              : fail("not-in-match", NOT_IN_MATCH, 409, told);
          }
          const window = found.startAt
            ? checkinWindow(found.startAt.getTime(), found, at)
            : null;
          if (window?.state === "early") {
            return fail("too-early", TOO_EARLY, 409, {
              ...told,
              opensAt: new Date(window.opensAt).toISOString(),
            });
          }
          // A match without a time has no window; staff tick its athletes by hand.
          if (!window || window.state === "closed") return fail("closed", CLOSED, 409, told);

          const id = crypto.randomUUID();
          try {
            await db.batch([
              abortUnless(
                db,
                actor.id,
                and(sportAccessIsAsRead(actor), stillChecksIn(matchId)) ?? sql`0`,
              ),
              db
                .insert(competitionMatchCheckin)
                .values({
                  id,
                  matchId,
                  participantId,
                  userId,
                  method: "scan",
                  checkedInBy: actor.id,
                })
                .onConflictDoNothing({
                  target: [competitionMatchCheckin.matchId, competitionMatchCheckin.userId],
                }),
            ]);
          } catch (error) {
            if (constraintError(error) === "stale") {
              return fail("match-closed", CLOSED_MATCH, 409, told);
            }
            throw error;
          }
          const [row] = await db
            .select()
            .from(competitionMatchCheckin)
            .where(checkinOf(matchId, userId));
          if (!row) throw new Error("Check-in vanished");
          const [after] = await summarize(db, [found], at);
          const latest = after as NonNullable<typeof after>;
          const side = latest.sides.find((s) => s.participantId === row.participantId);
          const duplicate = row.id !== id;
          return c.json(
            {
              code: duplicate ? ("duplicate" as const) : ("checked-in" as const),
              checkedInAt: row.createdAt.toISOString(),
              person: known,
              match: latest,
              side: {
                participantId: row.participantId,
                label: side?.label ?? "",
                checkedIn: side?.checkedIn ?? 0,
                min: latest.minPlayers,
              },
            },
            duplicate ? 200 : 201,
          );
        },
      )

      // Staff tick an athlete in: esports over Discord, or an override.
      .post(
        "/matches/:matchId/checkins",
        validate("param", matchParam),
        validate("json", matchCheckinManualInput),
        async (c) => {
          const db = c.var.db;
          const actor = c.var.user;
          const { matchId } = c.req.valid("param");
          const { participantId, userId } = c.req.valid("json");
          const [found] = await selectMatches(db, eq(competitionMatch.id, matchId));
          if (!found) return c.json({ message: NOT_FOUND }, 404);
          if (!(CHECKIN_STATUSES as readonly string[]).includes(found.status)) {
            return c.json({ message: CLOSED_MATCH }, 409);
          }
          const sides = await eligibleSides(db, userId, [matchId]);
          if (sides.get(matchId) !== participantId) return c.json({ message: NOT_ELIGIBLE }, 400);
          const [existing] = await db
            .select()
            .from(competitionMatchCheckin)
            .where(checkinOf(matchId, userId));
          if (existing && existing.participantId !== participantId) {
            return c.json({ message: OTHER_SIDE }, 409);
          }
          if (existing) {
            return c.json(
              {
                userId,
                participantId,
                method: existing.method,
                checkedInAt: existing.createdAt.toISOString(),
                checkedIn: await checkinCount(db, participantId),
                duplicate: true,
              },
              200,
            );
          }
          const id = crypto.randomUUID();
          try {
            await db.batch([
              abortUnless(
                db,
                actor.id,
                and(sportAccessIsAsRead(actor), stillChecksIn(matchId)) ?? sql`0`,
              ),
              db
                .insert(competitionMatchCheckin)
                .values({
                  id,
                  matchId,
                  participantId,
                  userId,
                  method: "manual",
                  checkedInBy: actor.id,
                })
                .onConflictDoNothing({
                  target: [competitionMatchCheckin.matchId, competitionMatchCheckin.userId],
                }),
              logCompetitionChange(db, actor, "checkin", matchId, "checkin", {
                participantId,
                userId,
              }),
            ]);
          } catch (error) {
            if (constraintError(error) === "stale") return c.json({ message: CLOSED_MATCH }, 409);
            throw error;
          }
          const [row] = await db
            .select()
            .from(competitionMatchCheckin)
            .where(checkinOf(matchId, userId));
          if (!row) throw new Error("Check-in vanished");
          if (row.participantId !== participantId) return c.json({ message: OTHER_SIDE }, 409);
          return c.json(
            {
              userId,
              participantId,
              method: row.method,
              checkedInAt: row.createdAt.toISOString(),
              checkedIn: await checkinCount(db, participantId),
              duplicate: row.id !== id,
            },
            row.id === id ? 201 : 200,
          );
        },
      )

      // Undo a check-in, scanned or ticked.
      .delete("/matches/:matchId/checkins/:userId", validate("param", checkinParam), async (c) => {
        const db = c.var.db;
        const actor = c.var.user;
        const { matchId, userId } = c.req.valid("param");
        const [found] = await db
          .select({ status: competitionMatch.status })
          .from(competitionMatch)
          .where(eq(competitionMatch.id, matchId));
        if (!found) return c.json({ message: NOT_FOUND }, 404);
        if (!(CHECKIN_STATUSES as readonly string[]).includes(found.status)) {
          return c.json({ message: CLOSED_MATCH }, 409);
        }
        const [existing] = await db
          .select({ participantId: competitionMatchCheckin.participantId })
          .from(competitionMatchCheckin)
          .where(checkinOf(matchId, userId));
        if (!existing) return c.json({ message: NO_CHECKIN }, 404);
        try {
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(
                sportAccessIsAsRead(actor),
                stillChecksIn(matchId),
                sql`exists (select 1 from ${competitionMatchCheckin} where ${checkinOf(matchId, userId)})`,
              ) ?? sql`0`,
            ),
            db.delete(competitionMatchCheckin).where(checkinOf(matchId, userId)),
            logCompetitionChange(db, actor, "checkin", matchId, "undo", {
              participantId: existing.participantId,
              userId,
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        return c.json(
          {
            userId,
            participantId: existing.participantId,
            checkedIn: await checkinCount(db, existing.participantId),
          },
          200,
        );
      })

      // After check-in closes, a side short of the minimum loses by forfeit.
      // When one side (or none) is left, the match is finished.
      .post(
        "/matches/:matchId/forfeit",
        validate("param", matchParam),
        validate("json", forfeitInput),
        async (c) => {
          const db = c.var.db;
          const actor = c.var.user;
          const at = now();
          if (!(canSport(actor, "matches.manage") || canSport(actor, "matches.score"))) {
            return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
          }
          const { matchId } = c.req.valid("param");
          const { participantIds, version } = c.req.valid("json");
          const match = await loadMatch(db, matchId);
          if (!match) return c.json({ message: NOT_FOUND }, 404);
          if (match.version !== version) return c.json({ message: STALE }, 409);
          if (
            !(CHECKIN_STATUSES as readonly string[]).includes(match.status) ||
            match.scoreSeq > 0
          ) {
            return c.json({ message: "แมตช์นี้เริ่มแข่งหรือจบไปแล้ว ปรับแพ้จากการรายงานตัวไม่ได้" }, 409);
          }
          if (
            !match.startAt ||
            checkinWindow(match.startAt.getTime(), match.division, at).state !== "closed"
          ) {
            return c.json({ message: "ยังไม่ปิดรายงานตัว ปรับแพ้ได้หลังปิดรายงานตัวแล้ว" }, 409);
          }
          const named = new Set(participantIds);
          const sideIds = new Set(match.participants.map((side) => side.id));
          if ([...named].some((id) => !sideIds.has(id))) {
            return c.json({ message: "ไม่พบฝั่งนี้ในแมตช์" }, 400);
          }
          const min = minPlayers(match.division);
          const counts = new Map(
            await Promise.all(
              [...named].map(async (id) => [id, await checkinCount(db, id)] as const),
            ),
          );
          if ([...counts.values()].some((n) => n >= min)) {
            return c.json({ message: "ฝั่งนี้รายงานตัวครบตามจำนวนขั้นต่ำแล้ว" }, 409);
          }

          const remaining = match.participants.filter((side) => !named.has(side.id));
          const finishes = remaining.length <= 1;
          const live = (match.liveState ?? {}) as Partial<MatchState>;
          const state: MatchState = {
            participants: match.participants.map((side) => {
              const forfeits = named.has(side.id);
              return {
                participantId: side.id,
                score: side.score,
                detail: side.detail,
                resultValue: side.resultValue,
                rank: forfeits
                  ? finishes && remaining.length === 1
                    ? 2
                    : null
                  : finishes
                    ? 1
                    : side.rank,
                outcome: forfeits ? "forfeit" : finishes ? "walkover_win" : side.outcome,
              };
            }),
            period: live.period ?? 1,
            phase: live.phase ?? "regular",
            decided: finishes,
            clock: null,
            timeline: [],
          };
          try {
            await db.batch([
              abortUnless(
                db,
                actor.id,
                and(
                  sportAccessIsAsRead(actor),
                  matchAsRead(matchId, version),
                  ...[...named].map((id) => sideShort(id, min)),
                ) ?? sql`0`,
              ),
              ...resultStatements(db, {
                matchId,
                state,
                ...(finishes
                  ? {
                      status: "finished" as const,
                      outcome: "forfeit" as const,
                      finishedAt: new Date(at),
                    }
                  : {}),
              }),
              logCompetitionChange(db, actor, "match", matchId, "forfeit", {
                participantIds: [...named],
                labels: match.participants
                  .filter((side) => named.has(side.id))
                  .map((side) => side.label),
                checkedIn: Object.fromEntries(counts),
                min,
                finished: finishes,
              }),
            ]);
          } catch (error) {
            if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
            throw error;
          }
          const saved = await loadMatch(db, matchId);
          return c.json(
            {
              matchId,
              status: saved?.status ?? match.status,
              outcome: saved?.outcome ?? null,
              version: saved?.version ?? version + 1,
              sides: (saved?.participants ?? []).map((side) => ({
                participantId: side.id,
                outcome: side.outcome,
                rank: side.rank,
              })),
            },
            200,
          );
        },
      )
  );
};

export type CompetitionCheckinRoutes = ReturnType<typeof createCompetitionCheckinRoutes>;
