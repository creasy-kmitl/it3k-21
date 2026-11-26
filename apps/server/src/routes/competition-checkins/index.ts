// Checking athletes in to matches at the venue kiosk or by hand (esports, via
// Discord), and forfeiting sides that did not turn up.
//
// An athlete scans the barcode on /me at a venue's kiosk and is checked in to
// their next match there whose check-in window is open: from the division's
// `checkinOpensMin` minutes before the start until `checkinClosesMin` minutes
// before it. They must be in their side's lineup when it has one, else in the
// team. Staff may tick athletes in or out by hand at any time before the match
// starts, and once check-in has closed, forfeit a side short of the minimum.
import { loadMatch, matchAsRead } from "../../competition/access";
import { logCompetitionChange } from "../../competition/audit";
import { resultStatements } from "../../competition/results";
import { matchCheckinManualInput, matchCheckinScanInput } from "@it3k/db/competition-rules";
import type { MatchState } from "@it3k/db/competition-rules";
import { parseScan } from "@it3k/db/event-rules";
import { competitionMatch, competitionMatchCheckin, venue } from "@it3k/db/schema/index";
import { and, asc, between, eq, inArray, sql } from "drizzle-orm";
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
  type MatchSummary,
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

const HOUR = 60 * 60_000;

const NOT_FOUND = "ไม่พบแมตช์นี้";
const NO_VENUE = "ไม่พบสนามนี้";
const STALE = "ข้อมูลแมตช์เปลี่ยนไปแล้ว โหลดใหม่แล้วลองอีกครั้ง";
const CLOSED_MATCH = "แมตช์นี้เริ่มแข่ง จบ หรือยกเลิกแล้ว เช็คอินไม่ได้";
const TICKET = "นี่คือ QR ตั๋วกิจกรรม ใช้บาร์โค้ดในหน้าโปรไฟล์ของนักกีฬาเพื่อรายงานตัวแข่งขัน";
const UNKNOWN = "ไม่พบบัญชีของบาร์โค้ดนี้";
const NO_MATCH = "ไม่มีแมตช์ของนักกีฬาคนนี้ที่สนามนี้ในช่วงนี้";
const NOT_IN_LINEUP = "ไม่อยู่ในรายชื่อผู้เล่นของแมตช์นี้ ติดต่อผู้จัดการทีม";
const TOO_EARLY = "ยังไม่เปิดรายงานตัว";
const CLOSED = "ปิดรายงานตัวแล้ว ติดต่อเจ้าหน้าที่สนาม";
const NOT_ELIGIBLE = "นักกีฬาคนนี้ไม่อยู่ในรายชื่อของฝั่งนี้";
const OTHER_SIDE = "นักกีฬาคนนี้เช็คอินกับอีกฝั่งไปแล้ว";
const NO_CHECKIN = "ไม่พบการเช็คอินนี้";

const checkinOf = (matchId: string, userId: string) =>
  and(eq(competitionMatchCheckin.matchId, matchId), eq(competitionMatchCheckin.userId, userId));

const venueParam = z.strictObject({ venueId: z.string().min(1) });
const matchParam = z.strictObject({ matchId: z.string().min(1) });
const checkinParam = z.strictObject({ matchId: z.string().min(1), userId: z.string().min(1) });
const listQuery = z.strictObject({ venueId: z.string().min(1).optional() });
const forfeitInput = z.strictObject({
  participantIds: z.array(z.string().min(1)).min(1).max(16),
  version: z.number().int().min(0),
});

export type ScanFailureCode =
  | "ticket"
  | "unknown"
  | "no-match"
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

      // Matches around now that still take check-ins, for the staff page.
      .get("/", validate("query", listQuery), async (c) => {
        const db = c.var.db;
        const at = now();
        const { venueId } = c.req.valid("query");
        const matches = await selectMatches(
          db,
          and(
            inArray(competitionMatch.status, [...CHECKIN_STATUSES]),
            between(competitionMatch.startAt, new Date(at - 3 * HOUR), new Date(at + 24 * HOUR)),
            venueId ? eq(competitionMatch.venueId, venueId) : undefined,
          ),
        );
        const venues = await db
          .select({ id: venue.id, name: venue.name })
          .from(venue)
          .orderBy(asc(venue.name));
        return c.json(
          {
            items: await summarize(db, matches, at),
            venues,
            now: new Date(at).toISOString(),
            canForfeit:
              canSport(c.var.user, "matches.manage") || canSport(c.var.user, "matches.score"),
          },
          200,
        );
      })

      // What a venue's kiosk shows: matches whose check-in is open or has
      // closed but not yet started, and the next one to open.
      .get("/venues/:venueId", validate("param", venueParam), async (c) => {
        const db = c.var.db;
        const at = now();
        const { venueId } = c.req.valid("param");
        const [place] = await db
          .select({ id: venue.id, name: venue.name })
          .from(venue)
          .where(eq(venue.id, venueId));
        if (!place) return c.json({ message: NO_VENUE }, 404);
        const matches = (
          await selectMatches(
            db,
            and(
              eq(competitionMatch.venueId, venueId),
              inArray(competitionMatch.status, [...CHECKIN_STATUSES]),
              between(competitionMatch.startAt, new Date(at), new Date(at + 25 * HOUR)),
            ),
          )
        ).filter((match) => match.checkinMode === "kiosk");
        const current = matches.filter(
          (match) =>
            match.startAt && checkinWindow(match.startAt.getTime(), match, at).state !== "early",
        );
        const upcoming = matches.find((match) => !current.includes(match));
        const next: MatchSummary | null = upcoming
          ? ((await summarize(db, [upcoming], at))[0] ?? null)
          : null;
        return c.json(
          {
            venue: place,
            now: new Date(at).toISOString(),
            matches: await summarize(db, current, at),
            next,
          },
          200,
        );
      })

      // The kiosk: the barcode on /me (an account id) checks the athlete in to
      // their next match at this venue whose window is open.
      .post(
        "/venues/:venueId/scan",
        validate("param", venueParam),
        validate("json", matchCheckinScanInput),
        async (c) => {
          const db = c.var.db;
          const actor = c.var.user;
          const at = now();
          const { venueId } = c.req.valid("param");
          const fail = (
            code: ScanFailureCode,
            message: string,
            status: 400 | 404 | 409,
            extra: Record<string, unknown> = {},
          ) => c.json({ code, message, ...extra }, status);

          const scanned = parseScan(c.req.valid("json").code);
          if ("ticketCode" in scanned) return fail("ticket", TICKET, 400);
          const [place] = await db
            .select({ id: venue.id })
            .from(venue)
            .where(eq(venue.id, venueId));
          if (!place) return c.json({ message: NO_VENUE }, 404);
          const { userId } = scanned;
          const known = await athleteFor(db, userId, null);
          if (!known) return fail("unknown", UNKNOWN, 404);

          // Matches here from a little before now, so a late athlete hears
          // check-in has closed rather than that they have no match.
          const nearby = (
            await selectMatches(
              db,
              and(
                eq(competitionMatch.venueId, venueId),
                inArray(competitionMatch.status, [...CHECKIN_STATUSES]),
                between(
                  competitionMatch.startAt,
                  new Date(at - 2 * HOUR),
                  new Date(at + 25 * HOUR),
                ),
              ),
            )
          ).filter((match) => match.checkinMode === "kiosk" && match.startAt);
          const ids = nearby.map((match) => match.id);
          const [eligible, onTeam] = await Promise.all([
            eligibleSides(db, userId, ids),
            teamMatches(db, userId, ids),
          ]);
          const windowOf = (match: (typeof nearby)[number]) =>
            checkinWindow((match.startAt as Date).getTime(), match, at);
          const target = nearby.find(
            (match) => eligible.has(match.id) && windowOf(match).state === "open",
          );

          if (!target) {
            const theirs = nearby.filter((match) => eligible.has(match.id) || onTeam.has(match.id));
            const person = await athleteFor(db, userId, theirs[0]?.divisionId ?? null);
            const [summary] = theirs[0] ? await summarize(db, [theirs[0]], at) : [];
            const benched = theirs.find(
              (match) => !eligible.has(match.id) && windowOf(match).state === "open",
            );
            if (benched) {
              const [match] = await summarize(db, [benched], at);
              return fail("not-in-lineup", NOT_IN_LINEUP, 409, { person, match });
            }
            const early = theirs.find(
              (match) => eligible.has(match.id) && windowOf(match).state === "early",
            );
            if (early) {
              const [match] = await summarize(db, [early], at);
              return fail("too-early", TOO_EARLY, 409, {
                person,
                match,
                opensAt: new Date(windowOf(early).opensAt).toISOString(),
              });
            }
            const late = theirs.find(
              (match) =>
                eligible.has(match.id) &&
                windowOf(match).state === "closed" &&
                (match.startAt as Date).getTime() >= at - HOUR,
            );
            if (late) {
              const [match] = await summarize(db, [late], at);
              return fail("closed", CLOSED, 409, { person, match });
            }
            return fail("no-match", NO_MATCH, 404, { person, match: summary ?? null });
          }

          const participantId = eligible.get(target.id) as string;
          const id = crypto.randomUUID();
          try {
            await db.batch([
              abortUnless(
                db,
                actor.id,
                and(sportAccessIsAsRead(actor), stillChecksIn(target.id)) ?? sql`0`,
              ),
              db
                .insert(competitionMatchCheckin)
                .values({
                  id,
                  matchId: target.id,
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
            if (constraintError(error) === "stale") return c.json({ message: CLOSED_MATCH }, 409);
            throw error;
          }
          const [row] = await db
            .select()
            .from(competitionMatchCheckin)
            .where(checkinOf(target.id, userId));
          if (!row) throw new Error("Check-in vanished");
          const [person, [match]] = await Promise.all([
            athleteFor(db, userId, target.divisionId),
            summarize(db, [target], at),
          ]);
          const side = match?.sides.find((s) => s.participantId === row.participantId);
          const duplicate = row.id !== id;
          return c.json(
            {
              code: duplicate ? ("duplicate" as const) : ("checked-in" as const),
              checkedInAt: row.createdAt.toISOString(),
              person: person as NonNullable<typeof person>,
              match: match as NonNullable<typeof match>,
              side: {
                participantId: row.participantId,
                label: side?.label ?? "",
                checkedIn: side?.checkedIn ?? 0,
                min: match?.minPlayers ?? 1,
              },
            },
            duplicate ? 200 : 201,
          );
        },
      )

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
