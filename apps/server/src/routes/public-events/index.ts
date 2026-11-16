// What a shared link to an event shows in chat apps and social sites (Open
// Graph). Public on purpose: link previews are fetched without signing in.
// Only what a preview needs: the name, a short description, when, where and
// the cover picture. Nothing about who registered or holds tickets.
import { event, venue } from "@it3k/db/schema/event";
import { and, asc, count, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { RouteDeps } from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { byRef } from "../events/checkins";

const refParam = z.strictObject({ ref: z.string().min(1).max(200) });

/** Previews are cached by the sites that fetch them anyway; spare the DB. */
const CACHE = "public, max-age=300";

/** Long enough for any preview; chat apps cut descriptions far shorter. */
export const PREVIEW_DESCRIPTION_LIMIT = 300;

const clip = (text: string | null) => {
  const flat = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!flat) return null;
  return flat.length > PREVIEW_DESCRIPTION_LIMIT
    ? `${flat.slice(0, PREVIEW_DESCRIPTION_LIMIT - 1)}…`
    : flat;
};

export const createPublicEventRoutes = (deps: Pick<RouteDeps, "getDb">) =>
  new Hono()
    // The events page: how many events take tickets now, and the soonest few.
    .get("/", async (c) => {
      const db = deps.getDb();
      const open = and(eq(event.ticketsOpen, true), gt(event.endAt, new Date()));
      const items = await db
        .select({ name: event.name, thumbnailUrl: event.thumbnailUrl })
        .from(event)
        .where(open)
        .orderBy(asc(event.startAt), asc(event.id))
        .limit(3);
      const [total] = await db.select({ total: count() }).from(event).where(open);
      c.header("Cache-Control", CACHE);
      return c.json({ total: total?.total ?? 0, items }, 200);
    })

    // One event, by id or slug.
    .get("/:ref", validate("param", refParam), async (c) => {
      const [row] = await deps
        .getDb()
        .select({
          id: event.id,
          slug: event.slug,
          name: event.name,
          description: event.description,
          startAt: event.startAt,
          endAt: event.endAt,
          thumbnailUrl: event.thumbnailUrl,
          venue: venue.name,
        })
        .from(event)
        .leftJoin(venue, eq(venue.id, event.venueId))
        .where(byRef(c.req.valid("param").ref))
        .limit(1);
      if (!row) return c.json({ message: "ไม่พบกิจกรรม" }, 404);
      c.header("Cache-Control", CACHE);
      return c.json(
        {
          ...row,
          description: clip(row.description),
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
        },
        200,
      );
    });

export type PublicEventRoutes = ReturnType<typeof createPublicEventRoutes>;
