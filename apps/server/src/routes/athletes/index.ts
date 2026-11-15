// Registration staff's view of athlete registrations: list, review, edit and
// export, each limited to the institutions policies/sports.ts lets them see.
import type { Database } from "@it3k/db";
import { INSTITUTION_IDS } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import {
  REGISTRATION_STATUSES,
  applicableFields,
  athlete,
  missingFields,
  registrationFields,
  reviewInput,
  sportDivision,
  sportRegistration,
  studentIdInput,
} from "@it3k/db/schema/sport";
import { type SQL, and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { limitJsonBody } from "../../middleware/json-body-limit";
import { validate } from "../../middleware/validation";
import {
  type SportPermission,
  canSport,
  inScope,
  sportAccess,
  sportAccessIsAsRead,
} from "../../policies/sports";
import { PAGE_SIZE, containsAny } from "../leadership";
import {
  type RegistrationRow,
  STALE,
  diff,
  logChange,
  registrationConflict,
  selectRegistrations,
} from "../registrations/shared";

const idParam = z.strictObject({ id: z.string().min(1) });

const filters = z.strictObject({
  q: z.string().trim().max(64).optional(),
  sportId: z.string().min(1).max(64).optional(),
  divisionId: z.string().min(1).max(64).optional(),
  status: z.enum(REGISTRATION_STATUSES).optional(),
  institution: z.enum(INSTITUTION_IDS).optional(),
});
const listQuery = filters.extend({
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const statusInput = reviewInput.and(z.strictObject({ version: z.number().int().positive() }));
const editInput = registrationFields.extend({
  studentId: studentIdInput,
  institution: z.enum(INSTITUTION_IDS),
  version: z.number().int().positive(),
});

function allow(permission: SportPermission) {
  return createMiddleware<CurrentUserEnv>(async (c, next) => {
    if (!canSport(c.var.user, permission)) return c.json({ message: "Forbidden" }, 403);
    await next();
  });
}

function where(actor: CurrentUser, query: z.infer<typeof filters>): SQL | undefined {
  return and(
    inScope(sportAccess(actor).scope, sportRegistration.institution),
    query.q ? containsAny([user.name, athlete.studentId], query.q) : undefined,
    query.sportId ? eq(sportDivision.sportId, query.sportId) : undefined,
    query.divisionId ? eq(sportRegistration.divisionId, query.divisionId) : undefined,
    query.status ? eq(sportRegistration.status, query.status) : undefined,
    query.institution ? eq(sportRegistration.institution, query.institution) : undefined,
  );
}

function toItem({ registration, division, sport, athlete: person, profile }: RegistrationRow) {
  return {
    ...registration,
    division,
    sport,
    athlete: {
      userId: registration.userId,
      name: person.name,
      image: person.image,
      studentId: person.studentId,
      prefix: profile?.prefix ?? "",
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      nickname: profile?.nickname ?? "",
      phone: profile?.phone ?? "",
    },
  };
}

function ordered(db: Database, actor: CurrentUser, query: z.infer<typeof filters>) {
  return selectRegistrations(db)
    .where(where(actor, query))
    .orderBy(
      asc(sportDivision.sortOrder),
      asc(sportRegistration.institution),
      desc(sportRegistration.createdAt),
      asc(sportRegistration.id),
    );
}

/** SQL: the registration is still at this version and inside the actor's scope. */
function registrationAsRead(actor: CurrentUser, id: string, version: number): SQL {
  return sql`exists (select 1 from ${sportRegistration} where ${sportRegistration.id} = ${id} and ${sportRegistration.version} = ${version} and ${inScope(sportAccess(actor).scope, sportRegistration.institution)})`;
}

async function findInScope(db: Database, actor: CurrentUser, id: string) {
  const [row] = await selectRegistrations(db).where(
    and(
      eq(sportRegistration.id, id),
      inScope(sportAccess(actor).scope, sportRegistration.institution),
    ),
  );
  return row ?? null;
}

export const createAthleteRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(limitJsonBody)

    .get("/", allow("athletes.read"), validate("query", listQuery), async (c) => {
      const { page, ...query } = c.req.valid("query");
      const actor = c.var.user;
      const rows = await ordered(c.var.db, actor, query)
        .limit(PAGE_SIZE + 1)
        .offset((page - 1) * PAGE_SIZE);
      return c.json(
        {
          items: rows.slice(0, PAGE_SIZE).map(toItem),
          page,
          hasMore: rows.length > PAGE_SIZE,
          scope: sportAccess(actor).scope,
          canReview: canSport(actor, "athletes.review"),
          canEdit: canSport(actor, "athletes.edit"),
          canExport: canSport(actor, "athletes.export"),
        },
        200,
      );
    })

    // Everything the filters match, for a CSV the web app builds.
    .get("/export", allow("athletes.export"), validate("query", filters), async (c) => {
      const rows = await ordered(c.var.db, c.var.user, c.req.valid("query"));
      return c.json({ items: rows.map(toItem) }, 200);
    })

    .put(
      "/:id/status",
      allow("athletes.review"),
      validate("param", idParam),
      validate("json", statusInput),
      async (c) => {
        const db = c.var.db;
        const actor = c.var.user;
        const { id } = c.req.valid("param");
        const { status, note, version } = c.req.valid("json");
        const row = await findInScope(db, actor, id);
        if (!row) return c.json({ message: "Registration not found" }, 404);
        const after = {
          status,
          reviewNote: note || null,
          reviewedBy: status === "review" ? null : actor.id,
          reviewedAt: status === "review" ? null : new Date(),
        };
        try {
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(sportAccessIsAsRead(actor), registrationAsRead(actor, id, version)) ?? sql`0`,
            ),
            db
              .update(sportRegistration)
              .set({ ...after, version: version + 1 })
              .where(eq(sportRegistration.id, id)),
            logChange(
              db,
              actor,
              row.registration,
              "review",
              diff(row.registration, {
                status: after.status,
                reviewNote: after.reviewNote,
              }),
            ),
          ]);
        } catch (error) {
          // Reopening a rejected registration whose shirt number or rank was taken since.
          const conflict = registrationConflict(error);
          if (conflict) return c.json({ message: conflict }, 409);
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const updated = await findInScope(db, actor, id);
        if (!updated) return c.json({ message: "Registration not found" }, 404);
        return c.json(toItem(updated), 200);
      },
    )

    .put(
      "/:id",
      allow("athletes.edit"),
      validate("param", idParam),
      validate("json", editInput),
      async (c) => {
        const db = c.var.db;
        const actor = c.var.user;
        const { id } = c.req.valid("param");
        const { studentId, institution, version, ...input } = c.req.valid("json");
        const row = await findInScope(db, actor, id);
        if (!row) return c.json({ message: "Registration not found" }, 404);
        const missing = missingFields(row.division, input);
        if (Object.keys(missing).length > 0) {
          return c.json({ message: Object.values(missing)[0] ?? "Invalid input" }, 400);
        }
        const fields = applicableFields(row.division, input);
        const userId = row.registration.userId;
        const changes = diff(
          { ...row.registration, studentId: row.athlete.studentId },
          { ...fields, studentId, institution },
        );
        try {
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(sportAccessIsAsRead(actor), registrationAsRead(actor, id, version)) ?? sql`0`,
            ),
            db
              .update(sportRegistration)
              .set({ ...fields, version: version + 1 })
              .where(eq(sportRegistration.id, id)),
            db
              .insert(athlete)
              .values({ userId, studentId })
              .onConflictDoUpdate({ target: athlete.userId, set: { studentId } }),
            // An institution belongs to the account, so it moves every registration with it.
            ...(institution === row.registration.institution
              ? []
              : [
                  db.update(user).set({ institution }).where(eq(user.id, userId)),
                  db
                    .update(sportRegistration)
                    .set({ institution, version: sql`${sportRegistration.version} + 1` })
                    .where(eq(sportRegistration.userId, userId)),
                ]),
            logChange(db, actor, row.registration, "edit", changes),
          ]);
        } catch (error) {
          const conflict = registrationConflict(error);
          if (conflict) return c.json({ message: conflict }, 409);
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        const updated = await findInScope(db, actor, id);
        if (!updated) return c.json({ message: "Registration not found" }, 404);
        return c.json(toItem(updated), 200);
      },
    );

export type AthleteRoutes = ReturnType<typeof createAthleteRoutes>;
