// Sport and general events. Members read them; catalog managers create, edit
// and delete them. Kiosk operators check people in, one check-in per ticket.
import type { Database } from "@it3k/db";
import { plainText } from "@it3k/db/rich-text";
import {
  CHECKIN_METHODS,
  EVENT_SUMMARY_MAX,
  EVENT_TYPES,
  type EventType,
  type TicketTypeInput,
  defaultTicketType,
  event,
  eventCheckin,
  eventDivision,
  eventDraftInput,
  eventInput,
  eventInstitution,
  eventSlugBase,
  eventTicket,
  eventTicketType,
  firstFreeSlug,
  ticketCode,
  venue,
} from "@it3k/db/schema/event";
import { sport, sportDivision } from "@it3k/db/schema/sport";
import { type SQL, and, asc, eq, gte, inArray, like, ne, notInArray, or, sql } from "drizzle-orm";
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
import { limitJsonBody } from "../../middleware/json-body-limit";
import { allowSport } from "../../middleware/sport-permission";
import { validate } from "../../middleware/validation";
import { canSport, sportAccess, sportAccessIsAsRead } from "../../policies/sports";
import {
  byRef,
  checkinsOf,
  findPerson,
  listParticipants,
  ticketCounts,
  ticketTypeCounts,
  ticketUnused,
  ticketsOf,
} from "./checkins";

// Every route takes an event's id or its slug, except editing and deleting
// the event itself, which take the id.
const idParam = z.strictObject({ id: z.string().min(1) });
const listQuery = z.strictObject({
  type: z.enum(EVENT_TYPES).optional(),
  // Events still running at or after this time; omit for every event.
  endsAfter: z.coerce.number().int().min(0).optional(),
});
const checkinParam = z.strictObject({ id: z.string().min(1), checkinId: z.string().min(1) });
const checkinInput = z
  .strictObject({
    // What the barcode on /me encodes: the account id. Also what the
    // participant list sends for a check-in by hand.
    userId: z.string().trim().min(1).max(128).optional(),
    // What a ticket's QR encodes after its prefix.
    ticketCode: ticketCode.optional(),
    method: z.enum(CHECKIN_METHODS),
    // Catalog managers may check in someone without a ticket.
    force: z.boolean().optional(),
  })
  .refine((input) => !input.userId !== !input.ticketCode, {
    message: "ส่ง userId หรือ ticketCode อย่างใดอย่างหนึ่ง",
  });
const updateInput = eventInput.and(z.strictObject({ version: z.number().int().positive() }));

/** Plenty for one festival; the list is not paged. */
const MAX_EVENTS = 500;

export const STALE = "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่";
const UNKNOWN_PERSON = "ไม่พบผู้ใช้จากรหัสนี้";
const ALREADY_IN = "เช็คอินไปแล้ว";
const ALL_USED = "ใช้ตั๋วครบทุกใบแล้ว";
const UNKNOWN_TICKET = "ไม่พบตั๋วจากรหัสนี้";
const NO_TICKET = "ยังไม่ได้รับตั๋วกิจกรรมนี้";
const WRONG_EVENT = "ตั๋วนี้เป็นของกิจกรรมอื่น";
const MISSING_LINK = "ไม่พบสถานที่หรือประเภทกีฬาที่เลือก กรุณาโหลดใหม่";
const SLUG_TAKEN = "ลิงก์นี้มีกิจกรรมอื่นใช้แล้ว ลองตั้งลิงก์อื่น";
const TYPE_IN_USE = "ลบประเภทตั๋วที่มีคนรับแล้วไม่ได้";
const HOUR_MS = 60 * 60 * 1000;
/** Tries at a generated slug, should another event take it meanwhile. */
const SLUG_ATTEMPTS = 3;

/** Slugs in use that a generated `base` could clash with: `base` and `base-<n>`. */
async function takenSlugs(db: Database, base: string, exceptId?: string) {
  const rows = await db
    .select({ slug: event.slug })
    .from(event)
    .where(
      and(
        // `base` is only a-z, 0-9 and hyphens, so it has no LIKE wildcards.
        or(eq(event.slug, base), like(event.slug, `${base}-%`)),
        exceptId ? ne(event.id, exceptId) : undefined,
      ),
    );
  return new Set(rows.flatMap((row) => (row.slug ? [row.slug] : [])));
}

/** A free slug made from the event's name, or from its type and date. */
async function generateSlug(
  db: Database,
  input: { name: string; type: EventType; startAt: number },
  exceptId?: string,
) {
  const base = eventSlugBase(input);
  return firstFreeSlug(base, await takenSlugs(db, base, exceptId));
}

/** Whether an event other than `exceptId` already uses `slug`. */
async function slugTaken(db: Database, slug: string, exceptId?: string) {
  const [row] = await db
    .select({ id: event.id })
    .from(event)
    .where(and(eq(event.slug, slug), exceptId ? ne(event.id, exceptId) : undefined));
  return !!row;
}

/** Events with their venue, institutions and divisions, in start order. */
async function loadEvents(db: Database, where: SQL | undefined) {
  const rows = await db
    .select({ event, venue: { id: venue.id, name: venue.name } })
    .from(event)
    .leftJoin(venue, eq(venue.id, event.venueId))
    .where(where)
    .orderBy(asc(event.startAt), asc(event.id))
    .limit(MAX_EVENTS);
  const ids = rows.map((row) => row.event.id);
  if (ids.length === 0) return [];
  const [institutions, divisions, tickets, types] = await Promise.all([
    db
      .select()
      .from(eventInstitution)
      .where(inArray(eventInstitution.eventId, ids))
      .orderBy(asc(eventInstitution.institution)),
    db
      .select({
        eventId: eventDivision.eventId,
        id: sportDivision.id,
        name: sportDivision.name,
        sportId: sport.id,
        sportName: sport.name,
        icon: sport.icon,
      })
      .from(eventDivision)
      .innerJoin(sportDivision, eq(sportDivision.id, eventDivision.divisionId))
      .innerJoin(sport, eq(sport.id, sportDivision.sportId))
      .where(inArray(eventDivision.eventId, ids))
      .orderBy(asc(sport.sortOrder), asc(sportDivision.sortOrder)),
    ticketCounts(db, ids),
    db
      .select()
      .from(eventTicketType)
      .where(inArray(eventTicketType.eventId, ids))
      .orderBy(asc(eventTicketType.sortOrder), asc(eventTicketType.createdAt)),
  ]);
  const typeCounts = await ticketTypeCounts(
    db,
    types.map((type) => type.id),
  );
  return rows.map((row) => ({
    ...row.event,
    venue: row.venue,
    ticketCount: tickets.get(row.event.id) ?? 0,
    ticketTypes: types
      .filter((type) => type.eventId === row.event.id)
      .map(({ eventId: _eventId, createdAt: _createdAt, updatedAt: _updatedAt, ...type }) => ({
        ...type,
        ticketCount: typeCounts.get(type.id) ?? 0,
      })),
    institutions: institutions
      .filter((item) => item.eventId === row.event.id)
      .map((item) => item.institution),
    divisions: divisions
      .filter((item) => item.eventId === row.event.id)
      .map(({ id, name, sportId, sportName, icon }) => ({ id, name, sportId, sportName, icon })),
  }));
}

function eventValues(input: z.infer<typeof eventInput>) {
  return {
    type: input.type,
    name: input.name,
    content: input.content,
    // The summary cards and link previews show.
    description: (input.content && plainText(input.content, EVENT_SUMMARY_MAX)) || null,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    venueId: input.venueId,
    thumbnailUrl: input.thumbnailUrl || null,
    ticketsOpen: input.ticketsOpen,
    ticketCapacity: input.ticketCapacity,
  };
}

function ticketTypeValues(type: TicketTypeInput, sortOrder: number) {
  return {
    name: type.name,
    description: type.description || null,
    capacity: type.capacity,
    maxPerUser: type.maxPerUser,
    open: type.open,
    sortOrder,
    listedOnly: type.listedOnly,
    allowedRoles: type.allowedRoles,
    allowedInstitutions: type.allowedInstitutions,
    allowedSportIds: type.allowedSportIds,
  };
}

function linkRows(db: Database, eventId: string, input: z.infer<typeof eventInput>) {
  return [
    ...(input.institutions.length > 0
      ? [
          db
            .insert(eventInstitution)
            .values(input.institutions.map((institution) => ({ eventId, institution }))),
        ]
      : []),
    ...(input.divisionIds.length > 0
      ? [
          db
            .insert(eventDivision)
            .values(input.divisionIds.map((divisionId) => ({ eventId, divisionId }))),
        ]
      : []),
  ];
}

export const createEventRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(limitJsonBody)

    .get("/", validate("query", listQuery), async (c) => {
      const { type, endsAfter } = c.req.valid("query");
      const items = await loadEvents(
        c.var.db,
        and(
          type ? eq(event.type, type) : undefined,
          endsAfter === undefined ? undefined : gte(event.endAt, new Date(endsAfter)),
        ),
      );
      return c.json({ items, canManage: canSport(c.var.user, "catalog.manage") }, 200);
    })

    .get("/:id", validate("param", idParam), async (c) => {
      const [item] = await loadEvents(c.var.db, byRef(c.req.valid("param").id));
      if (!item) return c.json({ message: "ไม่พบกิจกรรมนี้" }, 404);
      return c.json({ ...item, canManage: canSport(c.var.user, "catalog.manage") }, 200);
    })

    // A new event from a name and slug alone: a general event starting at
    // the next full hour for two hours, closed for tickets, with one ticket
    // type anyone may claim once. The rest is set on its edit tab.
    .post("/", allowSport("catalog.manage"), validate("json", eventDraftInput), async (c) => {
      const db = c.var.db;
      const input = c.req.valid("json");
      const id = crypto.randomUUID();
      const startAt = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS;
      const draft = { name: input.name, type: "general" as const, startAt };
      // A typed slug is used as it is, or refused if taken. A generated one
      // moves on to the next free "-<n>" when another event takes it first;
      // the unique index is what catches that, so no abortUnless is needed.
      const custom = input.slug || null;
      if (custom && (await slugTaken(db, custom))) return c.json({ message: SLUG_TAKEN }, 409);
      for (let attempt = 1; ; attempt++) {
        const slug = custom ?? (await generateSlug(db, draft));
        try {
          await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db.insert(event).values({
              id,
              ...draft,
              slug,
              startAt: new Date(startAt),
              endAt: new Date(startAt + 2 * HOUR_MS),
              ticketsOpen: false,
              createdBy: c.var.user.id,
            }),
            db
              .insert(eventTicketType)
              .values({ eventId: id, ...ticketTypeValues(defaultTicketType(), 0) }),
          ]);
          break;
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "unique") {
            if (custom) return c.json({ message: SLUG_TAKEN }, 409);
            if (attempt < SLUG_ATTEMPTS) continue;
            return c.json({ message: STALE }, 409);
          }
          throw error;
        }
      }
      const [created] = await loadEvents(db, eq(event.id, id));
      if (!created) throw new Error("Event vanished");
      return c.json(created, 201);
    })

    // A whole event each time: its institutions and divisions are replaced,
    // and its ticket types are matched by id (updated), added (no id) or
    // removed (left out). A type with tickets cannot be removed.
    .put(
      "/:id",
      allowSport("catalog.manage"),
      validate("param", idParam),
      validate("json", updateInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        const { version, ...input } = c.req.valid("json");
        const [current] = await db
          .select({ version: event.version, slug: event.slug })
          .from(event)
          .where(eq(event.id, id));
        if (!current) return c.json({ message: "ไม่พบกิจกรรมนี้" }, 404);
        if (current.version !== version) return c.json({ message: STALE }, 409);
        // Omitted keeps the slug; "" makes a new one from the name.
        let slug = input.slug === undefined ? current.slug : input.slug || null;
        if (slug && slug !== current.slug && (await slugTaken(db, slug, id))) {
          return c.json({ message: SLUG_TAKEN }, 409);
        }
        slug ??= await generateSlug(db, input, id);

        const existingTypes = await db
          .select({ id: eventTicketType.id })
          .from(eventTicketType)
          .where(eq(eventTicketType.eventId, id));
        const existingIds = new Set(existingTypes.map((type) => type.id));
        const keptIds = input.ticketTypes.flatMap((type) => (type.id ? [type.id] : []));
        // A type someone else removed meanwhile.
        if (keptIds.some((typeId) => !existingIds.has(typeId))) {
          return c.json({ message: STALE }, 409);
        }
        const removedIds = [...existingIds].filter((typeId) => !keptIds.includes(typeId));
        const removedInUse = async () => (await ticketTypeCounts(db, removedIds)).size > 0;
        if (await removedInUse()) return c.json({ message: TYPE_IN_USE }, 409);

        const typeRows = input.ticketTypes.map((type, index) =>
          type.id
            ? db
                .update(eventTicketType)
                .set(ticketTypeValues(type, index))
                .where(and(eq(eventTicketType.id, type.id), eq(eventTicketType.eventId, id)))
            : db.insert(eventTicketType).values({ eventId: id, ...ticketTypeValues(type, index) }),
        );
        try {
          await db.batch([
            abortUnless(
              db,
              c.var.user.id,
              and(
                sportAccessIsAsRead(c.var.user),
                sql`exists (select 1 from ${event} where ${event.id} = ${id} and ${event.version} = ${version})`,
              ) ?? sql`0`,
            ),
            db
              .update(event)
              .set({ ...eventValues(input), slug, version: version + 1 })
              .where(eq(event.id, id)),
            db.delete(eventInstitution).where(eq(eventInstitution.eventId, id)),
            db.delete(eventDivision).where(eq(eventDivision.eventId, id)),
            ...linkRows(db, id, input),
            db
              .delete(eventTicketType)
              .where(
                and(
                  eq(eventTicketType.eventId, id),
                  keptIds.length > 0 ? notInArray(eventTicketType.id, keptIds) : undefined,
                ),
              ),
            ...typeRows,
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "foreign-key") {
            // Someone claimed a ticket of a removed type meanwhile.
            if (removedIds.length > 0 && (await removedInUse())) {
              return c.json({ message: TYPE_IN_USE }, 409);
            }
            return c.json({ message: MISSING_LINK }, 400);
          }
          // Another event took the slug between the check and the write.
          if (constraintError(error) === "unique") return c.json({ message: SLUG_TAKEN }, 409);
          throw error;
        }
        const [updated] = await loadEvents(db, eq(event.id, id));
        if (!updated) return c.json({ message: "ไม่พบกิจกรรมนี้" }, 404);
        return c.json(updated, 200);
      },
    )

    .delete("/:id", allowSport("catalog.manage"), validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
          db.delete(event).where(eq(event.id, id)).returning({ id: event.id }),
        ]);
        if (!rows[0]) return c.json({ message: "ไม่พบกิจกรรมนี้" }, 404);
        return c.json({ id }, 200);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        throw error;
      }
    })

    // The kiosk's list and the participants page, limited to the viewer's scope.
    .get("/:id/participants", validate("param", idParam), async (c) => {
      const actor = c.var.user;
      if (!canSport(actor, "athletes.read") && !canSport(actor, "kiosk.operate")) {
        return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
      }
      const [item] = await c.var.db
        .select({ id: event.id, type: event.type })
        .from(event)
        .where(byRef(c.req.valid("param").id));
      if (!item) return c.json({ message: "ไม่พบกิจกรรมนี้" }, 404);
      const items = await listParticipants(c.var.db, item, sportAccess(actor).scope);
      return c.json(
        {
          items,
          canCheckIn: canSport(actor, "kiosk.operate"),
          canUndo: canSport(actor, "catalog.manage"),
          canExport: canSport(actor, "athletes.export") || canSport(actor, "catalog.manage"),
        },
        200,
      );
    })

    .post(
      "/:id/checkins",
      allowSport("kiosk.operate"),
      validate("param", idParam),
      validate("json", checkinInput),
      async (c) => {
        const db = c.var.db;
        const actor = c.var.user;
        const input = c.req.valid("json");
        const { method, force } = input;
        const [item] = await db
          .select({ id: event.id, type: event.type })
          .from(event)
          .where(byRef(c.req.valid("param").id));
        if (!item) return c.json({ message: "ไม่พบกิจกรรมนี้" }, 404);
        const id = item.id;
        const canForce = canSport(actor, "catalog.manage");

        // A ticket's QR names its holder and the ticket; the barcode on /me
        // and the participant list name only the holder.
        let userId: string;
        let scannedTicketId: string | null = null;
        let otherEvent: { id: string; name: string } | null = null;
        if (input.ticketCode) {
          const [scanned] = await db
            .select({
              id: eventTicket.id,
              userId: eventTicket.userId,
              eventId: event.id,
              eventName: event.name,
            })
            .from(eventTicket)
            .innerJoin(event, eq(event.id, eventTicket.eventId))
            .where(eq(eventTicket.code, input.ticketCode));
          if (!scanned) return c.json({ code: "unknown" as const, message: UNKNOWN_TICKET }, 404);
          userId = scanned.userId;
          if (scanned.eventId === id) scannedTicketId = scanned.id;
          else otherEvent = { id: scanned.eventId, name: scanned.eventName };
        } else {
          userId = input.userId ?? "";
        }
        const person = await findPerson(db, id, userId);
        if (!person) return c.json({ code: "unknown" as const, message: UNKNOWN_PERSON }, 404);

        const tickets = await ticketsOf(db, id, userId);
        const checkins = await checkinsOf(db, id, userId);
        const ticketInfo = (ticketId: string) => {
          const index = tickets.findIndex((ticket) => ticket.id === ticketId);
          const found = tickets[index];
          return found
            ? { id: found.id, typeName: found.typeName, index: index + 1, total: tickets.length }
            : null;
        };
        const duplicate = (at: Date | null | undefined, message: string, ticketId?: string) =>
          c.json(
            {
              code: "duplicate" as const,
              message,
              person,
              checkedInAt: (at ?? new Date()).toISOString(),
              ticket: ticketId ? ticketInfo(ticketId) : null,
            },
            409,
          );

        // The scanned ticket, or else their first ticket not used yet. A
        // ticket from another event still lets its holder in when they hold
        // an unused one to this event too.
        const scanned = scannedTicketId
          ? tickets.find((ticket) => ticket.id === scannedTicketId)
          : undefined;
        if (scanned?.checkinId) return duplicate(scanned.checkedInAt, ALREADY_IN, scanned.id);
        const target = scanned ?? tickets.find((ticket) => !ticket.checkinId) ?? null;
        if (!target) {
          const last = checkins.at(-1);
          if (tickets.length > 0)
            return duplicate(last?.createdAt, ALL_USED, last?.ticketId ?? undefined);
          if (checkins.some((row) => !row.ticketId)) return duplicate(last?.createdAt, ALREADY_IN);
          if (!(force && canForce)) {
            if (otherEvent) {
              return c.json(
                {
                  code: "wrong-event" as const,
                  message: `${WRONG_EVENT} (${otherEvent.name})`,
                  person,
                  canForce,
                  otherEvent,
                },
                409,
              );
            }
            return c.json(
              { code: "no-ticket" as const, message: NO_TICKET, person, canForce },
              409,
            );
          }
        }
        const forced = !target;
        const checkinId = crypto.randomUUID();
        try {
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(sportAccessIsAsRead(actor), target ? ticketUnused(target.id) : sql`1`) ?? sql`0`,
            ),
            db.insert(eventCheckin).values({
              id: checkinId,
              eventId: id,
              userId,
              ticketId: target?.id ?? null,
              checkedInBy: actor.id,
              method,
              forced,
            }),
          ]);
        } catch (error) {
          const kind = constraintError(error);
          // Checked in meanwhile, say at another desk.
          if (kind === "unique" || (kind === "stale" && target)) {
            const latest = await checkinsOf(db, id, userId);
            const row = target ? latest.find((item) => item.ticketId === target.id) : latest.at(-1);
            if (row) return duplicate(row.createdAt, ALREADY_IN, row.ticketId ?? undefined);
          }
          if (kind === "stale") return c.json({ message: STALE }, 409);
          if (kind === "foreign-key") return c.json({ message: "ไม่พบกิจกรรมนี้" }, 404);
          throw error;
        }
        const [row] = await db.select().from(eventCheckin).where(eq(eventCheckin.id, checkinId));
        if (!row) throw new Error("Check-in vanished");
        return c.json(
          {
            code: "checked-in" as const,
            person,
            checkinId,
            checkedInAt: row.createdAt.toISOString(),
            forced,
            ticket: target ? ticketInfo(target.id) : null,
          },
          201,
        );
      },
    )

    // Undo one check-in; its ticket can then be scanned again.
    .delete(
      "/:id/checkins/:checkinId",
      allowSport("catalog.manage"),
      validate("param", checkinParam),
      async (c) => {
        const db = c.var.db;
        const { id, checkinId } = c.req.valid("param");
        try {
          const [, rows] = await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db
              .delete(eventCheckin)
              .where(
                and(
                  inArray(
                    eventCheckin.eventId,
                    db.select({ id: event.id }).from(event).where(byRef(id)),
                  ),
                  eq(eventCheckin.id, checkinId),
                ),
              )
              .returning({ id: eventCheckin.id, userId: eventCheckin.userId }),
          ]);
          if (!rows[0]) return c.json({ message: "ไม่พบการเช็คอินนี้" }, 404);
          return c.json({ id: checkinId, userId: rows[0].userId }, 200);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
      },
    );

export type EventRoutes = ReturnType<typeof createEventRoutes>;
