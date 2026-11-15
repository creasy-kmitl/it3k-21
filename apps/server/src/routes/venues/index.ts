// Places events happen. Members read them for the event form's venue picker;
// catalog managers create, edit and delete them.
import { venue, venueInput } from "@it3k/db/schema/event";
import { asc, eq } from "drizzle-orm";
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

export const STALE = "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่";
const NAME_TAKEN = "มีสถานที่ชื่อนี้แล้ว";
const VENUE_IN_USE = "สถานที่นี้มีกิจกรรมอยู่ จึงลบไม่ได้";

function venueValues(input: z.infer<typeof venueInput>) {
  return {
    ...input,
    description: input.description || null,
    externalUrl: input.externalUrl || null,
  };
}

export const createVenueRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(limitJsonBody)

    .get("/", async (c) => {
      const items = await c.var.db.select().from(venue).orderBy(asc(venue.name));
      return c.json({ items, canManage: canSport(c.var.user, "catalog.manage") }, 200);
    })

    .post("/", allowSport("catalog.manage"), validate("json", venueInput), async (c) => {
      const db = c.var.db;
      try {
        const [, [created]] = await db.batch([
          abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
          db
            .insert(venue)
            .values(venueValues(c.req.valid("json")))
            .returning(),
        ]);
        if (!created) throw new Error("Insert returned no row");
        return c.json(created, 201);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (constraintError(error) === "unique") return c.json({ message: NAME_TAKEN }, 409);
        throw error;
      }
    })

    // A whole venue each time: the form always sends every field.
    .put(
      "/:id",
      allowSport("catalog.manage"),
      validate("param", idParam),
      validate("json", venueInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        try {
          const [, rows] = await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db
              .update(venue)
              .set(venueValues(c.req.valid("json")))
              .where(eq(venue.id, id))
              .returning(),
          ]);
          if (!rows[0]) return c.json({ message: "Venue not found" }, 404);
          return c.json(rows[0], 200);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "unique") return c.json({ message: NAME_TAKEN }, 409);
          throw error;
        }
      },
    )

    .delete("/:id", allowSport("catalog.manage"), validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
          db.delete(venue).where(eq(venue.id, id)).returning({ id: venue.id }),
        ]);
        if (!rows[0]) return c.json({ message: "Venue not found" }, 404);
        return c.json({ id }, 200);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (constraintError(error) === "foreign-key") return c.json({ message: VENUE_IN_USE }, 409);
        throw error;
      }
    });

export type VenueRoutes = ReturnType<typeof createVenueRoutes>;
