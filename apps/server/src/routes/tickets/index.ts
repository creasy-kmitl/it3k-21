// Event tickets. Any signed-in account claims its own ticket to an event that
// is open for tickets: any account for a general event, an athlete the event
// expects for a sport one. The ticket's QR is what the kiosk scans.
import type { Database } from "@it3k/db";
import {
  event,
  eventCheckin,
  eventDivision,
  eventTicket,
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
import { byRef, expectedAt } from "../events/checkins";

const idParam = z.strictObject({ id: z.string().min(1).max(128) });
const ticketParam = z.strictObject({ ticketId: z.string().min(1).max(128) });
// Claiming carries no data, but POSTs must be JSON (the CSRF guard).
const claimInput = z.strictObject({});

const NO_EVENT = "ไม่พบกิจกรรมนี้";
const CLOSED = "กิจกรรมนี้ไม่ได้เปิดรับตั๋วแล้ว";
const FULL = "ตั๋วกิจกรรมนี้เต็มแล้ว";
const NOT_LISTED = "คุณไม่อยู่ในรายชื่อของกิจกรรมนี้";
const CHECKED_IN = "เช็คอินแล้ว ยกเลิกตั๋วไม่ได้";
const NO_TICKET = "ไม่พบตั๋วนี้";

/** At most this many events are listed. */
const MAX_OPEN_EVENTS = 200;

/** SQL: tickets the event has handed out. */
const ticketCountOf = (eventId: SQL | string) =>
  sql<number>`(select count(*) from ${eventTicket} where ${eventTicket.eventId} = ${eventId})`;

/** SQL: the event takes claims now, from `userId`, and has a seat left. */
function claimable(item: { id: string; type: "sport" | "general" }, userId: string, now: Date) {
  return sql`exists (
    select 1 from ${event}
    where ${event.id} = ${item.id}
      and ${event.ticketsOpen} = 1
      and ${event.endAt} > ${now.getTime()}
      and (${event.ticketCapacity} is null or ${ticketCountOf(item.id)} < ${event.ticketCapacity})
  ) and ${item.type === "sport" ? expectedAt(item.id, userId) : sql`1`}`;
}

type ClaimRefusal = { code: "closed" | "full" | "not-listed"; message: string };

/** Why `userId` cannot claim a ticket to `item` right now, or null when they can. */
async function whyNot(
  db: Database,
  item: typeof event.$inferSelect,
  userId: string,
  now: Date,
): Promise<ClaimRefusal | null> {
  if (!item.ticketsOpen || item.endAt.getTime() <= now.getTime()) {
    return { code: "closed", message: CLOSED };
  }
  if (item.type === "sport") {
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, userId), expectedAt(item.id, userId)));
    if (!row) return { code: "not-listed", message: NOT_LISTED };
  }
  if (item.ticketCapacity !== null) {
    const [row] = await db
      .select({ n: count() })
      .from(eventTicket)
      .where(eq(eventTicket.eventId, item.id));
    if ((row?.n ?? 0) >= item.ticketCapacity) return { code: "full", message: FULL };
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
 * see: any general event, a sport event that expects them, or one they hold a
 * ticket to. `open` is whether a ticket can be claimed now.
 */
async function loadEventCards(db: Database, userId: string, where: SQL | undefined, now: Date) {
  const holds = sql`exists (select 1 from ${eventTicket} where ${eventTicket.eventId} = ${event.id} and ${eventTicket.userId} = ${userId})`;
  const rows = await db
    .select({
      event,
      venue: { id: venue.id, name: venue.name, externalUrl: venue.externalUrl },
      ticketCount: ticketCountOf(sql`${event.id}`),
      claimed: sql<number>`${holds}`,
    })
    .from(event)
    .leftJoin(venue, eq(venue.id, event.venueId))
    .where(
      and(
        where,
        sql`(${event.type} = 'general' or ${expectedAt(sql`${event.id}`, userId)} or ${holds})`,
      ),
    )
    .orderBy(asc(event.startAt), asc(event.id))
    .limit(MAX_OPEN_EVENTS);
  const sports = await sportsOf(
    db,
    rows.map((row) => row.event.id),
  );
  return rows.map((row) => ({
    id: row.event.id,
    slug: row.event.slug,
    type: row.event.type,
    name: row.event.name,
    description: row.event.description,
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
        : Math.max(0, row.event.ticketCapacity - Number(row.ticketCount)),
    claimed: !!row.claimed,
  }));
}

/** One ticket as its holder sees it. */
async function loadTickets(db: Database, userId: string, where?: SQL) {
  const rows = await db
    .select({
      id: eventTicket.id,
      code: eventTicket.code,
      claimedAt: eventTicket.createdAt,
      checkedInAt: eventCheckin.createdAt,
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
    .leftJoin(venue, eq(venue.id, event.venueId))
    .leftJoin(
      eventCheckin,
      and(eq(eventCheckin.eventId, eventTicket.eventId), eq(eventCheckin.userId, userId)),
    )
    .where(and(eq(eventTicket.userId, userId), where))
    .orderBy(asc(event.startAt), asc(event.id));
  const sports = await sportsOf(
    db,
    rows.map((row) => row.event.id),
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    claimedAt: row.claimedAt.toISOString(),
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    event: {
      ...row.event,
      startAt: row.event.startAt.toISOString(),
      endAt: row.event.endAt.toISOString(),
      sports: sports.get(row.event.id) ?? [],
    },
    venue: row.venue,
  }));
}

export const createTicketRoutes = (deps: RouteDeps) =>
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

    // One event's page: open or not, as long as the caller may see it (any
    // general event, a sport event that expects them, or one they hold a
    // ticket to), with their ticket when they have one. The ticket's code
    // (the QR) is left out; only the ticket's own page shows it.
    .get("/events/:id", validate("param", idParam), async (c) => {
      const db = c.var.db;
      const me = c.var.user.id;
      const [item] = await loadEventCards(db, me, byRef(c.req.valid("param").id), new Date());
      if (!item) return c.json({ code: "missing" as const, message: NO_EVENT }, 404);
      const [ticket] = await loadTickets(db, me, eq(eventTicket.eventId, item.id));
      return c.json(
        {
          ...item,
          ticket: ticket ? { id: ticket.id, checkedInAt: ticket.checkedInAt } : null,
        },
        200,
      );
    })

    // The caller's ticket to one event (by id or slug), QR code included.
    .get("/events/:id/ticket", validate("param", idParam), async (c) => {
      const [ticket] = await loadTickets(c.var.db, c.var.user.id, byRef(c.req.valid("param").id));
      if (!ticket) {
        return c.json({ code: "no-ticket" as const, message: "ยังไม่ได้รับตั๋วกิจกรรมนี้" }, 404);
      }
      return c.json({ ticket }, 200);
    })

    // Claim a ticket. Claiming one already held returns it again.
    .post("/events/:id", validate("param", idParam), validate("json", claimInput), async (c) => {
      const db = c.var.db;
      const me = c.var.user.id;
      const [item] = await db
        .select()
        .from(event)
        .where(byRef(c.req.valid("param").id));
      if (!item) return c.json({ code: "missing" as const, message: NO_EVENT }, 404);

      const existing = await loadTickets(db, me, eq(eventTicket.eventId, item.id));
      if (existing[0]) return c.json({ ticket: existing[0] }, 200);

      const now = new Date();
      const refusal = await whyNot(db, item, me, now);
      if (refusal) return c.json(refusal, 409);

      try {
        await db.batch([
          abortUnless(db, me, claimable(item, me, now)),
          db.insert(eventTicket).values({ eventId: item.id, userId: me, code: newTicketCode() }),
        ]);
      } catch (error) {
        const kind = constraintError(error);
        if (kind === "unique") {
          // Claimed meanwhile, say in another tab.
          const [ticket] = await loadTickets(db, me, eq(eventTicket.eventId, item.id));
          if (ticket) return c.json({ ticket }, 200);
        }
        if (kind === "stale") {
          const [fresh] = await db.select().from(event).where(eq(event.id, item.id));
          if (!fresh) return c.json({ code: "missing" as const, message: NO_EVENT }, 404);
          return c.json(
            (await whyNot(db, fresh, me, new Date())) ?? { code: "full", message: FULL },
            409,
          );
        }
        if (kind === "foreign-key") {
          return c.json({ code: "missing" as const, message: NO_EVENT }, 404);
        }
        throw error;
      }
      const [ticket] = await loadTickets(db, me, eq(eventTicket.eventId, item.id));
      if (!ticket) throw new Error("Ticket vanished");
      return c.json({ ticket }, 201);
    })

    // Hand a ticket back, while its holder has not checked in.
    .delete("/:ticketId", validate("param", ticketParam), async (c) => {
      const db = c.var.db;
      const me = c.var.user.id;
      const { ticketId } = c.req.valid("param");
      const [ticket] = await db
        .select({ eventId: eventTicket.eventId })
        .from(eventTicket)
        .where(and(eq(eventTicket.id, ticketId), eq(eventTicket.userId, me)));
      if (!ticket) return c.json({ message: NO_TICKET }, 404);
      const [checkin] = await db
        .select({ id: eventCheckin.id })
        .from(eventCheckin)
        .where(and(eq(eventCheckin.eventId, ticket.eventId), eq(eventCheckin.userId, me)));
      if (checkin) return c.json({ message: CHECKED_IN }, 409);
      const notCheckedIn = sql`not exists (select 1 from ${eventCheckin} where ${eventCheckin.eventId} = ${ticket.eventId} and ${eventCheckin.userId} = ${me})`;
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
