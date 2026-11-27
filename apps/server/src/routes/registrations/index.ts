// An athlete's own sport registrations. Registering needs a submitted
// participant profile, the student id and a photo of the student card. Both
// are remembered on the athlete row and offered again on the next form.
import type { Database } from "@it3k/db";
import type { Institution } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import { uploadedFile, userProfile } from "@it3k/db/schema/profile";
import {
  athlete,
  missingFields,
  registrationFields,
  sportDivision,
  sportRegistration,
  studentIdInput,
  applicableFields,
} from "@it3k/db/schema/sport";
import { MAX_PHOTO_SIZE, PHOTO_TYPES } from "@it3k/db/profile";
import { newSportCheckinCode } from "@it3k/db/competition-rules";
import { type SQL, and, asc, eq, isNull, sql } from "drizzle-orm";
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
import { type MailDeps, queueEmails, recipientOf } from "../../email/mailer";
import { validate } from "../../middleware/validation";
import { activeAccount, ownedPhoto } from "../profile";
import {
  approvedCounts,
  type DiscordDeps,
  STALE,
  diff,
  linkedDiscord,
  logChange,
  registrationConflict,
  selectRegistrations,
} from "./shared";

const idParam = z.strictObject({ id: z.string().min(1) });

// Optional in the schema so a missing value gets a field message, not a raw 400.
const studentCard = {
  // Left out: keep the remembered student id (required before there is one).
  studentId: studentIdInput.optional(),
  studentCardFileId: z.string().min(1).max(100).optional(),
};
const registerInput = registrationFields.extend({
  divisionId: z.string().min(1),
  ...studentCard,
});
const updateInput = registrationFields.extend({
  version: z.number().int().positive(),
  ...studentCard,
});
const withdrawInput = z.strictObject({ version: z.number().int().positive() });

const NO_PROFILE = "ส่งข้อมูลผู้เข้าร่วมให้ครบก่อนสมัครกีฬา";
const NO_INSTITUTION = "ระบุสถาบันในข้อมูลผู้เข้าร่วมก่อนสมัครกีฬา";
const CLOSED = "ประเภทนี้ปิดรับสมัครแล้ว";
const CLOSED_SINCE = "ประเภทนี้เพิ่งปิดรับสมัคร กรุณาโหลดใหม่";
const NEEDS_DISCORD = "เชื่อมบัญชี Discord ก่อนสมัครกีฬา Esports";
const DISCORD_OFF = "ยังไม่เปิดให้เชื่อม Discord จึงสมัคร Esports ไม่ได้ในตอนนี้";

const NO_STUDENT_ID = "กรอกรหัสนักศึกษา";
const NO_CARD = "แนบรูปบัตรนักศึกษา";
const BAD_CARD = "เลือกรูปบัตรนักศึกษาที่อัปโหลดสำเร็จ (JPEG, PNG หรือ WebP ไม่เกิน 10 MB)";

/** Whether `fileId` is a finished image upload of `userId`, for a friendly answer. */
async function isOwnedImage(db: Database, fileId: string, userId: string) {
  const [file] = await db
    .select({ contentType: uploadedFile.contentType, size: uploadedFile.size })
    .from(uploadedFile)
    .where(
      and(
        eq(uploadedFile.id, fileId),
        eq(uploadedFile.ownerId, userId),
        eq(uploadedFile.state, "ready"),
      ),
    );
  return (
    !!file && PHOTO_TYPES.some((type) => type === file.contentType) && file.size <= MAX_PHOTO_SIZE
  );
}

/**
 * Checks the student id and card a registration form sent against the
 * athlete's remembered ones: the missing ones as field issues, or what to save.
 */
async function studentCardFor(
  db: Database,
  userId: string,
  remembered: { studentId: string } | undefined,
  input: { studentId?: string; studentCardFileId?: string },
) {
  const studentId = input.studentId ?? remembered?.studentId;
  const cardId = input.studentCardFileId;
  const missing: Record<string, string> = {};
  if (!studentId) missing.studentId = NO_STUDENT_ID;
  if (!cardId) missing.studentCardFileId = NO_CARD;
  else if (!(await isOwnedImage(db, cardId, userId))) missing.studentCardFileId = BAD_CARD;
  return { missing, studentId, cardId };
}

/** Saves the student id and card on the athlete row, for the next registration. */
function rememberStudentCard(db: Database, userId: string, studentId: string, cardId: string) {
  return db
    .insert(athlete)
    .values({ userId, studentId, studentCardFileId: cardId })
    .onConflictDoUpdate({
      target: athlete.userId,
      set: { studentId, studentCardFileId: cardId },
    });
}

const fieldIssues = (missing: Record<string, string>) => ({
  message: Object.values(missing)[0] ?? "ข้อมูลไม่ถูกต้อง",
  issues: Object.entries(missing).map(([field, message]) => ({ path: [field], message })),
});

/** SQL: this registration is still the athlete's own, unreviewed, at this version. */
function ownReviewAt(id: string, userId: string, version: number): SQL {
  return sql`exists (select 1 from ${sportRegistration} where ${sportRegistration.id} = ${id} and ${sportRegistration.userId} = ${userId} and ${sportRegistration.version} = ${version} and ${sportRegistration.status} = 'review')`;
}

/** Tries before giving up on a free check-in code; a million codes make a clash rare. */
const CHECKIN_CODE_TRIES = 5;

/**
 * The athlete's sport check-in code, handed out on first ask; null for an
 * account that has never registered for a sport. Two tabs asking at once both
 * end up with whichever code was saved first.
 */
async function ensureCheckinCode(db: Database, userId: string, newCode: () => string) {
  const read = async () =>
    (
      await db
        .select({ code: athlete.checkinCode })
        .from(athlete)
        .where(eq(athlete.userId, userId))
    ).at(0);
  const row = await read();
  if (!row) return null;
  if (row.code) return row.code;
  for (let attempt = 0; attempt < CHECKIN_CODE_TRIES; attempt++) {
    try {
      await db
        .update(athlete)
        .set({ checkinCode: newCode() })
        .where(and(eq(athlete.userId, userId), isNull(athlete.checkinCode)));
    } catch (error) {
      if (constraintError(error) === "unique") continue;
      throw error;
    }
    const saved = await read();
    if (saved?.code || !saved) return saved?.code ?? null;
  }
  throw new Error("No free check-in code");
}

export const createRegistrationRoutes = (
  deps: RouteDeps & DiscordDeps & MailDeps & { newCheckinCode?: () => string },
) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(limitJsonBody)

    // The six digits /me shows as a barcode for a match's kiosk.
    .get("/me/checkin-code", async (c) => {
      const code = await ensureCheckinCode(
        c.var.db,
        c.var.user.id,
        deps.newCheckinCode ?? newSportCheckinCode,
      );
      return c.json({ code }, 200);
    })

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
      const institution = me.institution ?? (profile?.values?.institution || null);
      return c.json(
        {
          profileSubmitted: !!profile?.submittedAt,
          institution,
          // Places taken per division at this institution, against maxPerInstitution.
          approvedCounts: institution ? await approvedCounts(db, institution) : {},
          // .at(): indexing an array leaves undefined out of the type.
          studentId: athleteRows.at(0)?.studentId ?? null,
          // The card last attached, offered again on the next registration.
          studentCardFileId: athleteRows.at(0)?.studentCardFileId ?? null,
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
      const {
        divisionId,
        studentId: studentIdInput,
        studentCardFileId,
        ...input
      } = c.req.valid("json");

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
      if (!division) return c.json({ message: "ไม่พบประเภทนี้" }, 404);
      if (!division.registrationOpen) return c.json({ message: CLOSED }, 409);
      const card = await studentCardFor(db, me.id, athleteRow, {
        studentId: studentIdInput,
        studentCardFileId,
      });
      const missing = { ...card.missing, ...missingFields(division, input) };
      const { studentId, cardId } = card;
      if (Object.keys(missing).length > 0 || !studentId || !cardId) {
        return c.json(fieldIssues(missing), 400);
      }
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

      // No limit check here: the limit counts approvals, so it is checked on review.
      const stillOpen = and(
        activeAccount(),
        ownedPhoto(cardId, me.id),
        me.institution ? eq(user.institution, me.institution) : sql`${user.institution} is null`,
        sql`exists (select 1 from ${sportDivision} where ${sportDivision.id} = ${divisionId} and ${sportDivision.registrationOpen} = 1)`,
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
        studentCardFileId: cardId,
      };
      try {
        await db.batch([
          abortUnless(db, me.id, stillOpen ?? sql`0`),
          // The profile's institution becomes the account's on its first registration.
          ...(me.institution
            ? []
            : [db.update(user).set({ institution }).where(eq(user.id, me.id))]),
          rememberStudentCard(db, me.id, studentId, cardId),
          db.insert(sportRegistration).values(values),
          logChange(
            db,
            me,
            values,
            "register",
            diff<Record<string, unknown>>(
              { studentId: athleteRow?.studentId },
              { divisionId, institution, ...fields, studentId, studentCardFileId: cardId },
            ),
          ),
        ]);
      } catch (error) {
        const conflict = registrationConflict(error);
        if (conflict) return c.json({ message: conflict }, 409);
        if (constraintError(error) === "stale") {
          const gone = !(await isOwnedImage(db, cardId, me.id));
          return c.json(
            gone ? fieldIssues({ studentCardFileId: BAD_CARD }) : { message: CLOSED_SINCE },
            gone ? 400 : 409,
          );
        }
        throw error;
      }
      const [created] = await selectRegistrations(db).where(eq(sportRegistration.id, id));
      if (!created) throw new Error("Registration vanished");
      const to = await recipientOf(db, me.id);
      if (to) {
        await queueEmails(c, deps, [
          {
            kind: "sport-registered",
            to,
            registration: {
              sport: created.sport.name,
              division: created.division.name,
              gender: created.division.gender,
              format: created.division.format,
              institution: created.registration.institution,
              status: created.registration.status,
              shirtNumber: created.registration.shirtNumber,
              badmintonRank: created.registration.badmintonRank,
              ign: created.registration.ign,
            },
          },
        ]);
      }
      return c.json(
        { ...created.registration, division: created.division, sport: created.sport },
        201,
      );
    })

    .put("/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
      const db = c.var.db;
      const me = c.var.user;
      const { id } = c.req.valid("param");
      const {
        version,
        studentId: studentIdInput,
        studentCardFileId,
        ...input
      } = c.req.valid("json");
      const [row] = await db
        .select({
          registration: sportRegistration,
          division: sportDivision,
          studentId: athlete.studentId,
        })
        .from(sportRegistration)
        .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
        .leftJoin(athlete, eq(athlete.userId, sportRegistration.userId))
        .where(and(eq(sportRegistration.id, id), eq(sportRegistration.userId, me.id)));
      if (!row) return c.json({ message: "ไม่พบการสมัครนี้" }, 404);
      if (row.registration.status !== "review") {
        return c.json({ message: "แก้ไขได้เฉพาะตอนรอตรวจสอบ ติดต่อฝ่ายทะเบียนเพื่อแก้ไข" }, 409);
      }
      const card = await studentCardFor(
        db,
        me.id,
        row.studentId === null ? undefined : { studentId: row.studentId },
        { studentId: studentIdInput, studentCardFileId },
      );
      const missing = { ...card.missing, ...missingFields(row.division, input) };
      const { studentId, cardId } = card;
      if (Object.keys(missing).length > 0 || !studentId || !cardId) {
        return c.json(fieldIssues(missing), 400);
      }
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
      const changes = diff(
        { ...row.registration, studentId: row.studentId },
        { ...fields, ...discordUpdate, studentId, studentCardFileId: cardId },
      );
      try {
        await db.batch([
          abortUnless(
            db,
            me.id,
            and(activeAccount(), ownedPhoto(cardId, me.id), ownReviewAt(id, me.id, version)) ??
              sql`0`,
          ),
          db
            .update(sportRegistration)
            .set({ ...fields, ...discordUpdate, studentCardFileId: cardId, version: version + 1 })
            .where(eq(sportRegistration.id, id)),
          rememberStudentCard(db, me.id, studentId, cardId),
          logChange(db, me, row.registration, "update", changes),
        ]);
      } catch (error) {
        const conflict = registrationConflict(error);
        if (conflict) return c.json({ message: conflict }, 409);
        if (constraintError(error) === "stale") {
          if (!(await isOwnedImage(db, cardId, me.id))) {
            return c.json(fieldIssues({ studentCardFileId: BAD_CARD }), 400);
          }
          return c.json({ message: STALE }, 409);
        }
        throw error;
      }
      const [updated] = await selectRegistrations(db).where(eq(sportRegistration.id, id));
      if (!updated) return c.json({ message: "ไม่พบการสมัครนี้" }, 404);
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
        if (!registration) return c.json({ message: "ไม่พบการสมัครนี้" }, 404);
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
