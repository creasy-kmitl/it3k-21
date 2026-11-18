// Event tickets. Any signed-in account claims its own tickets to an event
// that is open for tickets, of a ticket type whose rules it passes (roles,
// institutions, sports, listed athletes), up to the type's per-person limit.
// Each ticket's QR is what the kiosk scans.
import type { Database } from "@it3k/db";
import {
  event,
  eventCheckin,
  eventDivision,
  eventTicket,
  eventTicketType,
  newTicketCode,
  venue,
} from "@it3k/db/schema/event";
import type { SportIcon } from "@it3k/db/sport-rules";
import { sport, sportDivision } from "@it3k/db/schema/sport";
import { user } from "@it3k/db/schema/auth";
import { type SQL, and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireUser,
} from "../../middleware/current-user";
import { limitJsonBody } from "../../middleware/json-body-limit";
import { validate } from "../../middleware/validation";
import { type MailDeps, queueEmails, recipientOf } from "../../email/mailer";
import { byRef, expectedAt } from "../events/checkins";
import {
  type Claimer,
  type TicketTypeRow,
  claimableSql,
  eventCountOf,
  loadClaimer,
  ruleRefusal,
} from "./eligibility";

const idParam = z.strictObject({ id: z.string().min(1).max(128) });
const ticketParam = z.strictObject({ ticketId: z.string().min(1).max(128) });
const claimInput = z.strictObject({ ticketTypeId: z.string().min(1).max(64) });

const NO_EVENT = "ไม่พบกิจกรรมนี้";
const NO_TYPE = "ไม่พบประเภทตั๋วนี้";
const CHECKED_IN = "เช็คอินแล้ว ยกเลิกตั๋วไม่ได้";
const NO_TICKET = "ไม่พบตั๋วนี้";

const REFUSALS = {
  closed: "กิจกรรมนี้ไม่ได้เปิดรับตั๋วแล้ว",
  "type-closed": "ตั๋วประเภทนี้ปิดรับแล้ว",
  full: "ตั๋วประเภทนี้เต็มแล้ว",
  limit: "คุณรับตั๋วประเภทนี้ครบจำนวนแล้ว",
  "not-listed": "คุณไม่อยู่ในรายชื่อของกิจกรรมนี้",
  "not-eligible": "ตั๋วประเภทนี้ไม่ได้เปิดให้คุณรับ",
} as const;
type RefusalCode = keyof typeof REFUSALS;
type ClaimRefusal = { code: RefusalCode; message: string };
const refusal = (code: RefusalCode): ClaimRefusal => ({ code, message: REFUSALS[code] });

/** At most this many events are listed. */
const MAX_OPEN_EVENTS = 200;

type EventRow = Pick<
  typeof event.$inferSelect,
  "id" | "ticketsOpen" | "endAt" | "ticketCapacity"
>;

/** Tickets handed out per type, and those `userId` holds per type. */
async function typeCounts(db: Database, typeIds: string[], userId: string) {
  const total = new Map<string, number>();
  const held = new Map<string, number>();
  if (typeIds.length === 0) return { total, held };
  const rows = await db
    .select({
      typeId: eventTicket.ticketTypeId,
      n: count(),
      mine: sql<number>`sum(case when ${eventTicket.userId} = ${userId} then 1 else 0 end)`,
    })
    .from(eventTicket)
    .where(inArray(eventTicket.ticketTypeId, typeIds))
    .groupBy(eventTicket.ticketTypeId);
  for (const row of rows) {
    if (!row.typeId) continue;
    total.set(row.typeId, row.n);
    held.set(row.typeId, Number(row.mine ?? 0));
  }
  return { total, held };
}

/**
 * Why `claimer` cannot claim one more ticket of `type` right now, or null
 * when they can. Counts come from `typeCounts` and the event's total.
 */
function whyNot(
  item: EventRow,
  type: TicketTypeRow,
  facts: { claimer: Claimer; listed: boolean; eventCount: number; typeCount: number; held: number },
  now: Date,
): ClaimRefusal | null {
  if (!item.ticketsOpen || item.endAt.getTime() <= now.getTime()) return refusal("closed");
  if (!type.open) return refusal("type-closed");
  const rule = ruleRefusal(type, facts.claimer, facts.listed);
  if (rule) return refusal(rule);
  if (facts.held >= type.maxPerUser) return refusal("limit");
  if (type.capacity !== null && facts.typeCount >= type.capacity) return refusal("full");
  if (item.ticketCapacity !== null && facts.eventCount >= item.ticketCapacity) {
    return refusal("full");
  }
  return null;
}

type EventSport = { id: string; name: string; icon: SportIcon };

/** The sports each event's divisions belong to, in catalog order, once each. */
async function sportsOf(db: Database, eventIds: string[]) {
  const bySport = new Map<string, EventSport[]>();
  if (eventIds.length === 0) return bySport;
  const rows = await db
    .select({ eventId: eventDivision.eventId, id: sport.id, name: sport.name, icon: sport.icon })
    .from(eventDivision)
    .innerJoin(sportDivision, eq(sportDivision.id, eventDivision.divisionId))
    .innerJoin(sport, eq(sport.id, sportDivision.sportId))
    .where(inArray(eventDivision.eventId, eventIds))
    .orderBy(asc(sport.sortOrder), asc(sportDivision.sortOrder));
  for (const row of rows) {
    const list = bySport.get(row.eventId) ?? [];
    if (!list.some((item) => item.id === row.id)) {
      list.push({ id: row.id, name: row.name, icon: row.icon });
    }
    bySport.set(row.eventId, list);
  }
  return bySport;
}

/**
 * Events as the participant pages show them, limited to those `userId` may
 * see: any general event, one with a ticket type whose rules they pass, or
 * one they hold a ticket to. Each type says whether they can claim it now.
 */
async function loadEventCards(db: Database, userId: string, where: SQL | undefined, now: Date) {
  const holds = sql`exists (select 1 from ${eventTicket} where ${eventTicket.eventId} = ${event.id} and ${eventTicket.userId} = ${userId})`;
  const rows = await db
    .select({
      event,
      venue: { id: venue.id, name: venue.name, externalUrl: venue.externalUrl },
      ticketCount: eventCountOf(sql`${event.id}`),
      claimed: sql<number>`${holds}`,
      listed: sql<number>`${expectedAt(sql`${event.id}`, userId)}`,
    })
    .from(event)
    .leftJoin(venue, eq(venue.id, event.venueId))
    .where(where)
    .orderBy(asc(event.startAt), asc(event.id))
    .limit(MAX_OPEN_EVENTS);
  const ids = rows.map((row) => row.event.id);
  const [sports, types, claimer] = await Promise.all([
    sportsOf(db, ids),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(eventTicketType)
          .where(inArray(eventTicketType.eventId, ids))
          .orderBy(asc(eventTicketType.sortOrder), asc(eventTicketType.createdAt)),
    loadClaimer(db, userId),
  ]);
  const counts = await typeCounts(
    db,
    types.map((type) => type.id),
    userId,
  );
  return rows.flatMap((row) => {
    const listed = !!row.listed;
    const eventCount = Number(row.ticketCount);
    const ticketTypes = types
      .filter((type) => type.eventId === row.event.id)
      .map((type) => {
        const typeCount = counts.total.get(type.id) ?? 0;
        const held = counts.held.get(type.id) ?? 0;
        const why = whyNot(row.event, type, { claimer, listed, eventCount, typeCount, held }, now);
        return {
          id: type.id,
          name: type.name,
          description: type.description,
          capacity: type.capacity,
          remaining: type.capacity === null ? null : Math.max(0, type.capacity - typeCount),
          maxPerUser: type.maxPerUser,
          open: type.open,
          held,
          // Whether its rules let the caller in at all, open or not.
          eligible: ruleRefusal(type, claimer, listed) === null,
          canClaim: why === null,
          refusal: why?.code ?? null,
        };
      });
    const claimed = !!row.claimed;
    if (row.event.type !== "general" && !claimed && !ticketTypes.some((type) => type.eligible)) {
      return [];
    }
    return [
      {
        id: row.event.id,
        slug: row.event.slug,
        type: row.event.type,
        name: row.event.name,
        description: row.event.description,
        content: row.event.content,
        startAt: row.event.startAt.toISOString(),
        endAt: row.event.endAt.toISOString(),
        thumbnailUrl: row.event.thumbnailUrl,
        sports: sports.get(row.event.id) ?? [],
        venue: row.venue,
        open: row.event.ticketsOpen && row.event.endAt.getTime() > now.getTime(),
        capacity: row.event.ticketCapacity,
        remaining:
          row.event.ticketCapacity === null
            ? null
            : Math.max(0, row.event.ticketCapacity - eventCount),
        claimed,
        ticketTypes,
      },
    ];
  });
}

/** One ticket as its holder sees it. */
async function loadTickets(db: Database, userId: string, where?: SQL) {
  const rows = await db
    .select({
      id: eventTicket.id,
      code: eventTicket.code,
      claimedAt: eventTicket.createdAt,
      checkedInAt: eventCheckin.createdAt,
      ticketType: { id: eventTicketType.id, name: eventTicketType.name },
      event: {
        id: event.id,
        slug: event.slug,
        type: event.type,
        name: event.name,
        startAt: event.startAt,
        endAt: event.endAt,
        thumbnailUrl: event.thumbnailUrl,
      },
      venue: { id: venue.id, name: venue.name },
    })
    .from(eventTicket)
    .innerJoin(event, eq(event.id, eventTicket.eventId))
    .leftJoin(eventTicketType, eq(eventTicketType.id, eventTicket.ticketTypeId))
    .leftJoin(venue, eq(venue.id, event.venueId))
    .leftJoin(eventCheckin, eq(eventCheckin.ticketId, eventTicket.id))
    .where(and(eq(eventTicket.userId, userId), where))
    .orderBy(
      asc(event.startAt),
      asc(event.id),
      asc(eventTicketType.sortOrder),
      asc(eventTicket.createdAt),
      // Same-millisecond claims keep their insert order.
      sql`"event_ticket"."rowid"`,
      asc(eventTicket.id),
    );
  const sports = await sportsOf(
    db,
    rows.map((row) => row.event.id),
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    claimedAt: row.claimedAt.toISOString(),
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    ticketType: row.ticketType,
    event: {
      ...row.event,
      startAt: row.event.startAt.toISOString(),
      endAt: row.event.endAt.toISOString(),
      sports: sports.get(row.event.id) ?? [],
    },
    venue: row.venue,
  }));
}

export const createTicketRoutes = (deps: RouteDeps & MailDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(limitJsonBody)

    // The caller's tickets, soonest event first.
    .get("/", async (c) => {
      const items = await loadTickets(c.var.db, c.var.user.id);
      return c.json({ items }, 200);
    })

    // Events the caller can claim a ticket to (or already holds one for),
    // still open and not over.
    .get("/events", async (c) => {
      const now = new Date();
      const items = await loadEventCards(
        c.var.db,
        c.var.user.id,
        and(eq(event.ticketsOpen, true), gt(event.endAt, now)),
        now,
      );
      return c.json({ items }, 200);
    })

    // One event's page: open or not, as long as the caller may see it, with
    // the tickets they hold. Ticket codes (the QR) are left out; only the
    // ticket page shows them.
    .get("/events/:id", validate("param", idParam), async (c) => {
      const db = c.var.db;
      const me = c.var.user.id;
      const [item] = await loadEventCards(db, me, byRef(c.req.valid("param").id), new Date());
      if (!item) return c.json({ code: "missing" as const, message: NO_EVENT }, 404);
      const tickets = await loadTickets(db, me, eq(eventTicket.eventId, item.id));
      return c.json(
        {
          ...item,
          tickets: tickets.map((ticket) => ({
            id: ticket.id,
            ticketType: ticket.ticketType,
            checkedInAt: ticket.checkedInAt,
          })),
        },
        200,
      );
    })

    // The caller's tickets to one event (by id or slug), QR codes included.
    .get("/events/:id/ticket", validate("param", idParam), async (c) => {
      const tickets = await loadTickets(c.var.db, c.var.user.id, byRef(c.req.valid("param").id));
      if (tickets.length === 0) {
        return c.json({ code: "no-ticket" as const, message: "ยังไม่ได้รับตั๋วกิจกรรมนี้" }, 404);
      }
      return c.json({ tickets }, 200);
    })

    // Claim one ticket of a type. Claiming a type that allows one per
    // person, already held, returns that ticket again.
    .post("/events/:id", validate("param", idParam), validate("json", claimInput), async (c) => {
      const db = c.var.db;
      const me = c.var.user.id;
      const { ticketTypeId } = c.req.valid("json");
      const [item] = await db
        .select()
        .from(event)
        .where(byRef(c.req.valid("param").id));
      if (!item) return c.json({ code: "missing" as const, message: NO_EVENT }, 404);
      const [type] = await db
        .select()
        .from(eventTicketType)
        .where(and(eq(eventTicketType.id, ticketTypeId), eq(eventTicketType.eventId, item.id)));
      if (!type) return c.json({ code: "missing" as const, message: NO_TYPE }, 404);

      const mineOfType = () =>
        loadTickets(
          db,
          me,
          and(eq(eventTicket.eventId, item.id), eq(eventTicket.ticketTypeId, type.id)),
        );
      const held = await mineOfType();
      if (type.maxPerUser === 1 && held[0]) return c.json({ ticket: held[0] }, 200);

      // The facts `whyNot` needs, read fresh.
      const facts = async (now: Date) => {
        const [counts, [listed], [total], claimer] = await Promise.all([
          typeCounts(db, [type.id], me),
          db
            .select({ yes: sql<number>`${expectedAt(item.id, me)}` })
            .from(user)
            .where(eq(user.id, me)),
          db.select({ n: count() }).from(eventTicket).where(eq(eventTicket.eventId, item.id)),
          loadClaimer(db, me),
        ]);
        const [freshEvent] = await db.select().from(event).where(eq(event.id, item.id));
        const [freshType] = await db
          .select()
          .from(eventTicketType)
          .where(eq(eventTicketType.id, type.id));
        if (!freshEvent || !freshType) return null;
        return whyNot(
          freshEvent,
          freshType,
          {
            claimer,
            listed: !!listed?.yes,
            eventCount: total?.n ?? 0,
            typeCount: counts.total.get(type.id) ?? 0,
            held: counts.held.get(type.id) ?? 0,
          },
          now,
        );
      };

      const now = new Date();
      const why = await facts(now);
      if (why) return c.json(why, 409);

      const id = crypto.randomUUID();
      try {
        await db.batch([
          abortUnless(db, me, claimableSql(item.id, type.id, me, now)),
          db.insert(eventTicket).values({
            id,
            eventId: item.id,
            ticketTypeId: type.id,
            userId: me,
            code: newTicketCode(),
          }),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        if (kind === "stale") {
          // Claimed meanwhile, say in another tab.
          const again = await mineOfType();
          if (type.maxPerUser === 1 && again[0]) return c.json({ ticket: again[0] }, 200);
          const fresh = await facts(new Date());
          return c.json(fresh ?? refusal("full"), 409);
        }
        if (kind === "foreign-key") {
          return c.json({ code: "missing" as const, message: NO_EVENT }, 404);
        }
        throw error;
      }
      const ticket = (await mineOfType()).find((row) => row.id === id);
      if (!ticket) throw new Error("Ticket vanished");
      const to = await recipientOf(db, me);
      if (to) {
        await queueEmails(c, deps, [
          {
            kind: "ticket-claimed",
            to,
            ticket: {
              ref: ticket.event.slug ?? ticket.event.id,
              eventName: ticket.event.name,
              ticketTypeName: type.name,
              startAt: Date.parse(ticket.event.startAt),
              endAt: Date.parse(ticket.event.endAt),
              venue: ticket.venue?.name ?? null,
              code: ticket.code,
            },
          },
        ]);
      }
      return c.json({ ticket }, 201);
    })

    // Hand a ticket back, while it has not been checked in.
    .delete("/:ticketId", validate("param", ticketParam), async (c) => {
      const db = c.var.db;
      const me = c.var.user.id;
      const { ticketId } = c.req.valid("param");
      const [ticket] = await db
        .select({ id: eventTicket.id })
        .from(eventTicket)
        .where(and(eq(eventTicket.id, ticketId), eq(eventTicket.userId, me)));
      if (!ticket) return c.json({ message: NO_TICKET }, 404);
      const [checkin] = await db
        .select({ id: eventCheckin.id })
        .from(eventCheckin)
        .where(eq(eventCheckin.ticketId, ticketId));
      if (checkin) return c.json({ message: CHECKED_IN }, 409);
      const notCheckedIn = sql`not exists (select 1 from ${eventCheckin} where ${eventCheckin.ticketId} = ${ticketId})`;
      try {
        const [, rows] = await db.batch([
          abortUnless(db, me, notCheckedIn),
          db
            .delete(eventTicket)
            .where(and(eq(eventTicket.id, ticketId), eq(eventTicket.userId, me)))
            .returning({ id: eventTicket.id }),
        ]);
        if (!rows[0]) return c.json({ message: NO_TICKET }, 404);
        return c.json({ id: ticketId }, 200);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: CHECKED_IN }, 409);
        throw error;
      }
    });

export type TicketRoutes = ReturnType<typeof createTicketRoutes>;
