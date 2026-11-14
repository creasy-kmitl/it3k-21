// Sport and general events. Members read them; catalog managers create, edit
// and delete them. Check-ins and participants come with the kiosk.
import type { Database } from "@it3k/db";
import {
  EVENT_TYPES,
  event,
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
import { canSport, sportAccessIsAsRead } from "../../policies/sports";

const idParam = z.strictObject({ id: z.string().min(1) });
const listQuery = z.strictObject({
  type: z.enum(EVENT_TYPES).optional(),
  // Events still running at or after this time; omit for every event.
  endsAfter: z.coerce.number().int().min(0).optional(),
});
const updateInput = eventInput.and(z.strictObject({ version: z.number().int().positive() }));

/** Plenty for one festival; the list is not paged. */
const MAX_EVENTS = 500;

export const STALE = "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่";
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
    });

export type EventRoutes = ReturnType<typeof createEventRoutes>;
