// Sport and general events. Members read them; catalog managers create, edit
// and delete them. Kiosk operators check people in.
import type { Database } from "@it3k/db";
import {
  CHECKIN_METHODS,
  EVENT_TYPES,
  event,
  eventCheckin,
  eventDivision,
  eventInput,
  eventInstitution,
  venue,
} from "@it3k/db/schema/event";
import { sport, sportDivision } from "@it3k/db/schema/sport";
import { type SQL, and, asc, eq, gte, inArray, sql } from "drizzle-orm";
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
import { expectedAt, findCheckin, findPerson, listParticipants } from "./checkins";

const idParam = z.strictObject({ id: z.string().min(1) });
const listQuery = z.strictObject({
  type: z.enum(EVENT_TYPES).optional(),
  // Events still running at or after this time; omit for every event.
  endsAfter: z.coerce.number().int().min(0).optional(),
});
const checkinParam = z.strictObject({ id: z.string().min(1), userId: z.string().min(1) });
const checkinInput = z.strictObject({
  // What the barcode on /me encodes: the account id.
  userId: z.string().trim().min(1).max(128),
  method: z.enum(CHECKIN_METHODS),
  // Catalog managers may check in someone the event does not expect.
  force: z.boolean().optional(),
});
const updateInput = eventInput.and(z.strictObject({ version: z.number().int().positive() }));

/** Plenty for one festival; the list is not paged. */
const MAX_EVENTS = 500;

export const STALE = "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่";
const UNKNOWN_PERSON = "ไม่พบผู้ใช้จากรหัสนี้";
const ALREADY_IN = "เช็คอินไปแล้ว";
const NOT_LISTED = "ไม่อยู่ในรายชื่อของกิจกรรมนี้";
const MISSING_LINK = "ไม่พบสถานที่หรือประเภทกีฬาที่เลือก กรุณาโหลดใหม่";

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
  const [institutions, divisions] = await Promise.all([
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
  ]);
  return rows.map((row) => ({
    ...row.event,
    venue: row.venue,
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
    description: input.description || null,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    venueId: input.venueId,
    thumbnailUrl: input.thumbnailUrl || null,
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
      const [item] = await loadEvents(c.var.db, eq(event.id, c.req.valid("param").id));
      if (!item) return c.json({ message: "Event not found" }, 404);
      return c.json({ ...item, canManage: canSport(c.var.user, "catalog.manage") }, 200);
    })

    .post("/", allowSport("catalog.manage"), validate("json", eventInput), async (c) => {
      const db = c.var.db;
      const input = c.req.valid("json");
      const id = crypto.randomUUID();
      try {
        await db.batch([
          abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
          db.insert(event).values({ id, ...eventValues(input), createdBy: c.var.user.id }),
          ...linkRows(db, id, input),
        ]);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (constraintError(error) === "foreign-key") return c.json({ message: MISSING_LINK }, 400);
        throw error;
      }
      const [created] = await loadEvents(db, eq(event.id, id));
      if (!created) throw new Error("Event vanished");
      return c.json(created, 201);
    })

    // A whole event each time: its institutions and divisions are replaced.
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
          .select({ version: event.version })
          .from(event)
          .where(eq(event.id, id));
        if (!current) return c.json({ message: "Event not found" }, 404);
        if (current.version !== version) return c.json({ message: STALE }, 409);
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
              .set({ ...eventValues(input), version: version + 1 })
              .where(eq(event.id, id)),
            db.delete(eventInstitution).where(eq(eventInstitution.eventId, id)),
            db.delete(eventDivision).where(eq(eventDivision.eventId, id)),
            ...linkRows(db, id, input),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "foreign-key") {
            return c.json({ message: MISSING_LINK }, 400);
          }
          throw error;
        }
        const [updated] = await loadEvents(db, eq(event.id, id));
        if (!updated) return c.json({ message: "Event not found" }, 404);
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
        if (!rows[0]) return c.json({ message: "Event not found" }, 404);
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
        return c.json({ message: "Forbidden" }, 403);
      }
      const [item] = await c.var.db
        .select({ id: event.id, type: event.type })
        .from(event)
        .where(eq(event.id, c.req.valid("param").id));
      if (!item) return c.json({ message: "Event not found" }, 404);
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
        const { id } = c.req.valid("param");
        const { userId, method, force } = c.req.valid("json");
        const [item] = await db
          .select({ id: event.id, type: event.type })
          .from(event)
          .where(eq(event.id, id));
        if (!item) return c.json({ message: "Event not found" }, 404);
        const person = await findPerson(db, id, userId);
        if (!person) return c.json({ code: "unknown" as const, message: UNKNOWN_PERSON }, 404);

        const already = await findCheckin(db, id, userId);
        if (already) {
          return c.json(
            {
              code: "duplicate" as const,
              message: ALREADY_IN,
              person,
              checkedInAt: already.createdAt.toISOString(),
            },
            409,
          );
        }
        const expected = item.type === "general" || person.divisions.length > 0;
        const forced = !expected;
        if (forced && !(force && canSport(actor, "catalog.manage"))) {
          return c.json(
            {
              code: "not-listed" as const,
              message: NOT_LISTED,
              person,
              canForce: canSport(actor, "catalog.manage"),
            },
            409,
          );
        }
        try {
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(
                sportAccessIsAsRead(actor),
                item.type === "sport" && !forced ? expectedAt(id, userId) : sql`1`,
              ) ?? sql`0`,
            ),
            db.insert(eventCheckin).values({
              eventId: id,
              userId,
              checkedInBy: actor.id,
              method,
              forced,
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "unique") {
            const row = await findCheckin(db, id, userId);
            return c.json(
              {
                code: "duplicate" as const,
                message: ALREADY_IN,
                person,
                checkedInAt: (row?.createdAt ?? new Date()).toISOString(),
              },
              409,
            );
          }
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "foreign-key") {
            return c.json({ message: "Event not found" }, 404);
          }
          throw error;
        }
        const row = await findCheckin(db, id, userId);
        if (!row) throw new Error("Check-in vanished");
        return c.json(
          { code: "checked-in" as const, person, checkedInAt: row.createdAt.toISOString(), forced },
          201,
        );
      },
    )

    .delete(
      "/:id/checkins/:userId",
      allowSport("catalog.manage"),
      validate("param", checkinParam),
      async (c) => {
        const db = c.var.db;
        const { id, userId } = c.req.valid("param");
        try {
          const [, rows] = await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db
              .delete(eventCheckin)
              .where(and(eq(eventCheckin.eventId, id), eq(eventCheckin.userId, userId)))
              .returning({ id: eventCheckin.id }),
          ]);
          if (!rows[0]) return c.json({ message: "Check-in not found" }, 404);
          return c.json({ userId }, 200);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
      },
    );

export type EventRoutes = ReturnType<typeof createEventRoutes>;
