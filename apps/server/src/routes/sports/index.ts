import type { Database } from "@it3k/db";
import { divisionInput, sport, sportDivision, sportInput } from "@it3k/db/schema/sport";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
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
import { canSport, sportAccessIsAsRead } from "../../policies/sports";

const idParam = z.strictObject({ id: z.string().min(1) });

const nonEmpty = <T extends object>(input: T) => Object.keys(input).length > 0;
const sportPatch = sportInput.partial().refine(nonEmpty, "Nothing to update");
const divisionPatch = divisionInput.partial().refine(nonEmpty, "Nothing to update");

export const STALE = "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่";
const SPORT_CODE_TAKEN = "มีกีฬาที่ใช้รหัสนี้แล้ว";
const DIVISION_CODE_TAKEN = "มีประเภทที่ใช้รหัสนี้แล้ว";
const SPORT_IN_USE = "ลบประเภทย่อยทั้งหมดของกีฬานี้ก่อน";
const DIVISION_IN_USE = "ประเภทนี้มีผู้สมัครหรือกิจกรรมอยู่ จึงลบไม่ได้";

/** Blank optional text is stored as null. */
const orNull = (value: string | undefined) => (value === undefined ? undefined : value || null);

function sportValues<T extends Partial<z.infer<typeof sportInput>>>(input: T) {
  return {
    ...input,
    description: orNull(input.description),
    thumbnailUrl: orNull(input.thumbnailUrl),
  };
}

export async function listSports(db: Database) {
  const [sports, divisions] = await Promise.all([
    db.select().from(sport).orderBy(asc(sport.sortOrder), asc(sport.name)),
    db
      .select()
      .from(sportDivision)
      .orderBy(asc(sportDivision.sortOrder), asc(sportDivision.name)),
  ]);
  return sports.map((row) => ({
    ...row,
    divisions: divisions.filter((division) => division.sportId === row.id),
  }));
}

const catalogManager = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!canSport(c.var.user, "catalog.manage")) {
    return c.json({ message: "Forbidden" }, 403);
  }
  await next();
});

export const createSportRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    // Athletes pick from this list too, so signing in is enough to read it.
    .use(requireUser(deps))
    .use(limitJsonBody)

    .get("/", async (c) => {
      const items = await listSports(c.var.db);
      return c.json({ items, canManage: canSport(c.var.user, "catalog.manage") }, 200);
    })

    .post("/", catalogManager, validate("json", sportInput), async (c) => {
      const db = c.var.db;
      try {
        const [, [created]] = await db.batch([
          abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
          db.insert(sport).values(sportValues(c.req.valid("json"))).returning(),
        ]);
        if (!created) throw new Error("Insert returned no row");
        return c.json({ ...created, divisions: [] }, 201);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (constraintError(error) === "unique") return c.json({ message: SPORT_CODE_TAKEN }, 409);
        throw error;
      }
    })

    .patch(
      "/:id",
      catalogManager,
      validate("param", idParam),
      validate("json", sportPatch),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        try {
          const [, rows] = await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db
              .update(sport)
              .set(sportValues(c.req.valid("json")))
              .where(eq(sport.id, id))
              .returning(),
          ]);
          if (!rows[0]) return c.json({ message: "Sport not found" }, 404);
          return c.json(rows[0], 200);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "unique") {
            return c.json({ message: SPORT_CODE_TAKEN }, 409);
          }
          throw error;
        }
      },
    )

    .delete("/:id", catalogManager, validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
          db.delete(sport).where(eq(sport.id, id)).returning({ id: sport.id }),
        ]);
        if (!rows[0]) return c.json({ message: "Sport not found" }, 404);
        return c.json({ id }, 200);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (constraintError(error) === "foreign-key") {
          return c.json({ message: SPORT_IN_USE }, 409);
        }
        throw error;
      }
    })

    .post(
      "/:id/divisions",
      catalogManager,
      validate("param", idParam),
      validate("json", divisionInput),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        try {
          const [, [created]] = await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db
              .insert(sportDivision)
              .values({ ...c.req.valid("json"), sportId: id })
              .returning(),
          ]);
          if (!created) throw new Error("Insert returned no row");
          return c.json(created, 201);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "unique") {
            return c.json({ message: DIVISION_CODE_TAKEN }, 409);
          }
          if (constraintError(error) === "foreign-key") {
            return c.json({ message: "Sport not found" }, 404);
          }
          throw error;
        }
      },
    )

    .patch(
      "/divisions/:id",
      catalogManager,
      validate("param", idParam),
      validate("json", divisionPatch),
      async (c) => {
        const db = c.var.db;
        const { id } = c.req.valid("param");
        try {
          const [, rows] = await db.batch([
            abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
            db
              .update(sportDivision)
              .set(c.req.valid("json"))
              .where(eq(sportDivision.id, id))
              .returning(),
          ]);
          if (!rows[0]) return c.json({ message: "Division not found" }, 404);
          return c.json(rows[0], 200);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          if (constraintError(error) === "unique") {
            return c.json({ message: DIVISION_CODE_TAKEN }, 409);
          }
          throw error;
        }
      },
    )

    .delete("/divisions/:id", catalogManager, validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, sportAccessIsAsRead(c.var.user)),
          db
            .delete(sportDivision)
            .where(eq(sportDivision.id, id))
            .returning({ id: sportDivision.id }),
        ]);
        if (!rows[0]) return c.json({ message: "Division not found" }, 404);
        return c.json({ id }, 200);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (constraintError(error) === "foreign-key") {
          return c.json({ message: DIVISION_IN_USE }, 409);
        }
        throw error;
      }
    });

export type SportRoutes = ReturnType<typeof createSportRoutes>;
