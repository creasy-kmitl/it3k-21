// An athlete's own sport registrations. Registering needs a submitted
// participant profile; the first registration also records the student id.
import type { Institution } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import { userProfile } from "@it3k/db/schema/profile";
import {
  athlete,
  missingFields,
  registrationFields,
  sportDivision,
  sportRegistration,
  studentIdInput,
  applicableFields,
} from "@it3k/db/schema/sport";
import { type SQL, and, asc, eq, sql } from "drizzle-orm";
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
import { activeAccount } from "../profile";
import {
  type DiscordDeps,
  STALE,
  diff,
  linkedDiscord,
  logChange,
  registrationConflict,
  selectRegistrations,
} from "./shared";

const idParam = z.strictObject({ id: z.string().min(1) });

const registerInput = registrationFields.extend({
  divisionId: z.string().min(1),
  // Required on the first registration only; ignored afterwards.
  studentId: studentIdInput.optional(),
});
const updateInput = registrationFields.extend({ version: z.number().int().positive() });
const withdrawInput = z.strictObject({ version: z.number().int().positive() });

const NO_PROFILE = "ส่งข้อมูลผู้เข้าร่วมให้ครบก่อนสมัครกีฬา";
const NO_INSTITUTION = "ระบุสถาบันในข้อมูลผู้เข้าร่วมก่อนสมัครกีฬา";
const CLOSED = "ประเภทนี้ปิดรับสมัครแล้ว";
const FULL_OR_CLOSED = "ประเภทนี้ปิดรับสมัครหรือครบจำนวนแล้ว กรุณาโหลดใหม่";
const NEEDS_DISCORD = "เชื่อมบัญชี Discord ก่อนสมัครกีฬา Esports";
const DISCORD_OFF = "ยังไม่เปิดให้เชื่อม Discord จึงสมัคร Esports ไม่ได้ในตอนนี้";

const fieldIssues = (missing: Record<string, string>) => ({
  message: Object.values(missing)[0] ?? "Invalid input",
  issues: Object.entries(missing).map(([field, message]) => ({ path: [field], message })),
});

/** SQL: this registration is still the athlete's own, unreviewed, at this version. */
function ownReviewAt(id: string, userId: string, version: number): SQL {
  return sql`exists (select 1 from ${sportRegistration} where ${sportRegistration.id} = ${id} and ${sportRegistration.userId} = ${userId} and ${sportRegistration.version} = ${version} and ${sportRegistration.status} = 'review')`;
}

export const createRegistrationRoutes = (deps: RouteDeps & DiscordDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(limitJsonBody)

    .get("/me", async (c) => {
      const db = c.var.db;
      const me = c.var.user;
      const [[profile], athleteRows, rows, discord] = await Promise.all([
        db
          .select({ values: userProfile.values, submittedAt: userProfile.submittedAt })
          .from(userProfile)
          .where(eq(userProfile.userId, me.id)),
        db.select().from(athlete).where(eq(athlete.userId, me.id)),
        selectRegistrations(db)
          .where(eq(sportRegistration.userId, me.id))
          .orderBy(asc(sportRegistration.createdAt)),
        linkedDiscord(db, me.id),
      ]);
      const username = discord
        ? await deps.discordProfile(c.req.raw.headers, discord.id).catch(() => null)
        : null;
      return c.json(
        {
          profileSubmitted: !!profile?.submittedAt,
          institution: me.institution ?? (profile?.values?.institution || null),
          // .at(): indexing an array leaves undefined out of the type.
          studentId: athleteRows.at(0)?.studentId ?? null,
          discord: {
            enabled: deps.discordEnabled,
            linked: discord
              ? {
                  accountId: discord.id,
                  userId: discord.discordUserId,
                  username: username?.username ?? null,
                }
              : null,
          },
          registrations: rows.map(({ registration, division, sport }) => ({
            ...registration,
            division,
            sport,
          })),
        },
        200,
      );
    })

    .post("/", validate("json", registerInput), async (c) => {
      const db = c.var.db;
      const me = c.var.user;
      const { divisionId, studentId, ...input } = c.req.valid("json");

      const [[profile], [athleteRow], [division]] = await Promise.all([
        db
          .select({ values: userProfile.values, submittedAt: userProfile.submittedAt })
          .from(userProfile)
          .where(eq(userProfile.userId, me.id)),
        db.select().from(athlete).where(eq(athlete.userId, me.id)),
        db.select().from(sportDivision).where(eq(sportDivision.id, divisionId)),
      ]);
      if (!profile?.submittedAt || !profile.values) return c.json({ message: NO_PROFILE }, 409);
      const institution: Institution | null =
        me.institution ?? (profile.values.institution || null);
      if (!institution) return c.json({ message: NO_INSTITUTION }, 409);
      if (!athleteRow && !studentId) {
        return c.json(fieldIssues({ studentId: "กรอกรหัสนักศึกษา" }), 400);
      }
      if (!division) return c.json({ message: "Division not found" }, 404);
      if (!division.registrationOpen) return c.json({ message: CLOSED }, 409);
      const missing = missingFields(division, input);
      if (Object.keys(missing).length > 0) return c.json(fieldIssues(missing), 400);
      const fields = applicableFields(division, input);

      let discordUserId: string | null = null;
      let discordUsername: string | null = null;
      if (division.requiresGameProfile) {
        if (!deps.discordEnabled) return c.json({ message: DISCORD_OFF }, 409);
        const discord = await linkedDiscord(db, me.id);
        if (!discord) return c.json({ message: NEEDS_DISCORD }, 409);
        discordUserId = discord.discordUserId;
        discordUsername =
          (await deps.discordProfile(c.req.raw.headers, discord.id).catch(() => null))?.username ??
          null;
      }

      const max = division.maxPerInstitution;
      const stillOpen = and(
        activeAccount(),
        me.institution ? eq(user.institution, me.institution) : sql`${user.institution} is null`,
        sql`exists (select 1 from ${sportDivision} where ${sportDivision.id} = ${divisionId} and ${sportDivision.registrationOpen} = 1)`,
        max === null
          ? sql`1`
          : sql`(select count(*) from ${sportRegistration} where ${sportRegistration.divisionId} = ${divisionId} and ${sportRegistration.institution} = ${institution} and ${sportRegistration.status} <> 'rejected') < (select coalesce(${sportDivision.maxPerInstitution}, 1000000) from ${sportDivision} where ${sportDivision.id} = ${divisionId})`,
      );
      const id = crypto.randomUUID();
      const values = {
        id,
        userId: me.id,
        divisionId,
        institution,
        ...fields,
        discordUserId,
        discordUsername,
      };
      try {
        await db.batch([
          abortUnless(db, me.id, stillOpen ?? sql`0`),
          // The profile's institution becomes the account's on its first registration.
          ...(me.institution
            ? []
            : [db.update(user).set({ institution }).where(eq(user.id, me.id))]),
          ...(athleteRow || !studentId
            ? []
            : [db.insert(athlete).values({ userId: me.id, studentId })]),
          db.insert(sportRegistration).values(values),
          logChange(db, me, values, "register", diff({}, { divisionId, institution, ...fields })),
        ]);
      } catch (error) {
        const conflict = registrationConflict(error);
        if (conflict) return c.json({ message: conflict }, 409);
        if (constraintError(error) === "stale") return c.json({ message: FULL_OR_CLOSED }, 409);
        // A first registration racing another one: both insert the athlete row.
        if (constraintError(error) === "unique") return c.json({ message: STALE }, 409);
        throw error;
      }
      const [created] = await selectRegistrations(db).where(eq(sportRegistration.id, id));
      if (!created) throw new Error("Registration vanished");
      return c.json(
        { ...created.registration, division: created.division, sport: created.sport },
        201,
      );
    })

    .put("/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
      const db = c.var.db;
      const me = c.var.user;
      const { id } = c.req.valid("param");
      const { version, ...input } = c.req.valid("json");
      const [row] = await db
        .select({ registration: sportRegistration, division: sportDivision })
        .from(sportRegistration)
        .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
        .where(and(eq(sportRegistration.id, id), eq(sportRegistration.userId, me.id)));
      if (!row) return c.json({ message: "Registration not found" }, 404);
      if (row.registration.status !== "review") {
        return c.json({ message: "แก้ไขได้เฉพาะตอนรอตรวจสอบ ติดต่อฝ่ายทะเบียนเพื่อแก้ไข" }, 409);
      }
      const missing = missingFields(row.division, input);
      if (Object.keys(missing).length > 0) return c.json(fieldIssues(missing), 400);
      const fields = applicableFields(row.division, input);
      let discordUpdate = {};
      if (row.division.requiresGameProfile) {
        const discord = await linkedDiscord(db, me.id);
        if (!discord) return c.json({ message: NEEDS_DISCORD }, 409);
        const profile = await deps.discordProfile(c.req.raw.headers, discord.id).catch(() => null);
        discordUpdate = {
          discordUserId: discord.discordUserId,
          discordUsername: profile?.username ?? row.registration.discordUsername,
        };
      }
      const changes = diff(row.registration, { ...fields, ...discordUpdate });
      try {
        await db.batch([
          abortUnless(db, me.id, and(activeAccount(), ownReviewAt(id, me.id, version)) ?? sql`0`),
          db
            .update(sportRegistration)
            .set({ ...fields, ...discordUpdate, version: version + 1 })
            .where(eq(sportRegistration.id, id)),
          logChange(db, me, row.registration, "update", changes),
        ]);
      } catch (error) {
        const conflict = registrationConflict(error);
        if (conflict) return c.json({ message: conflict }, 409);
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        throw error;
      }
      const [updated] = await selectRegistrations(db).where(eq(sportRegistration.id, id));
      if (!updated) return c.json({ message: "Registration not found" }, 404);
      return c.json(
        { ...updated.registration, division: updated.division, sport: updated.sport },
        200,
      );
    })

    // Withdraws an unreviewed registration; reviewed ones go through staff.
    .post(
      "/:id/withdraw",
      validate("param", idParam),
      validate("json", withdrawInput),
      async (c) => {
        const db = c.var.db;
        const me = c.var.user;
        const { id } = c.req.valid("param");
        const { version } = c.req.valid("json");
        const [registration] = await db
          .select()
          .from(sportRegistration)
          .where(and(eq(sportRegistration.id, id), eq(sportRegistration.userId, me.id)));
        if (!registration) return c.json({ message: "Registration not found" }, 404);
        if (registration.status !== "review") {
          return c.json({ message: "ถอนได้เฉพาะตอนรอตรวจสอบ ติดต่อฝ่ายทะเบียนเพื่อถอน" }, 409);
        }
        try {
          await db.batch([
            abortUnless(db, me.id, and(activeAccount(), ownReviewAt(id, me.id, version)) ?? sql`0`),
            db.delete(sportRegistration).where(eq(sportRegistration.id, id)),
            logChange(db, me, registration, "withdraw", {
              divisionId: [registration.divisionId, null],
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
          throw error;
        }
        return c.json({ id }, 200);
      },
    );

export type RegistrationRoutes = ReturnType<typeof createRegistrationRoutes>;
