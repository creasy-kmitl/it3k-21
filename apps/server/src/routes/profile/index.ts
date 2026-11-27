import { parseRoles } from "@it3k/auth/permissions";
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { uploadedFile, userProfile } from "@it3k/db/schema/profile";
import {
  type Institution,
  type ProfileValues,
  draftInput,
  submitInput,
  PHOTO_TYPES,
  MAX_PHOTO_SIZE,
} from "@it3k/db/profile";
import { and, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireUser,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { limitJsonBody } from "../../middleware/json-body-limit";
import { type MailDeps, queueEmails } from "../../email/mailer";

export function activeAccount() {
  return sql`(coalesce(${user.banned}, 0) = 0 or (${user.banExpires} is not null and ${user.banExpires} <= ${Date.now()}))`;
}

/** SQL: `id` is a finished image upload of `ownerId`, small enough for a photo. */
export function ownedPhoto(id: string, ownerId: string) {
  return sql`exists (select 1 from ${uploadedFile} where ${uploadedFile.id} = ${id} and ${uploadedFile.ownerId} = ${ownerId} and ${uploadedFile.state} = 'ready' and ${uploadedFile.size} <= ${MAX_PHOTO_SIZE} and ${uploadedFile.contentType} in ('image/jpeg', 'image/png', 'image/webp'))`;
}

/**
 * The institution an account holder can no longer change themselves: the
 * account's own (from an invitation, staff or a sport registration), or the one
 * their submitted profile names. `null` while they may still choose. Only those
 * with users.setInstitution change it afterwards (PUT /api/users/:id/institution).
 */
export function lockedInstitution(
  account: Institution | null,
  profile: { submittedAt: Date | null; values: ProfileValues | null } | null | undefined,
): Institution | null {
  if (account) return account;
  if (profile?.submittedAt && profile.values?.institution) return profile.values.institution;
  return null;
}

/** SQL on the `user` row: its institution is still what the route read. */
function institutionAsRead(institution: Institution | null) {
  return institution ? eq(user.institution, institution) : sql`${user.institution} is null`;
}

/** Reads what lockedInstitution needs, and the account's address for the first-submit email. */
async function readLockState(db: Database, id: string) {
  const [row] = await db
    .select({
      email: user.email,
      institution: user.institution,
      submittedAt: userProfile.submittedAt,
      values: userProfile.values,
    })
    .from(user)
    .leftJoin(userProfile, eq(userProfile.userId, user.id))
    .where(eq(user.id, id));
  if (!row) return null;
  return { ...row, locked: lockedInstitution(row.institution, row) };
}

export const createProfileRoutes = (deps: RouteDeps & MailDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(limitJsonBody)
    .get("/me", async (c) => {
      const db = c.var.db;
      const [account] = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          institution: user.institution,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(eq(user.id, c.var.user.id));
      if (!account) return c.json({ message: "กรุณาเข้าสู่ระบบ" }, 401);
      const profile = (
        await db.select().from(userProfile).where(eq(userProfile.userId, account.id))
      ).at(0);
      const { institution: accountInstitution, ...accountFields } = account;
      return c.json(
        {
          // Set once the holder can no longer change it; the form then shows it read-only.
          institution: lockedInstitution(accountInstitution, profile),
          account: {
            ...accountFields,
            roles: parseRoles(account.role),
            departmentId: c.var.user.departmentId,
            seatRole: c.var.user.leadershipRole,
          },
          profile: profile?.values ?? null,
          draft: profile?.draft ?? null,
          revision: profile?.revision ?? 0,
          hasDraft: profile?.dirty ?? false,
          submittedAt: profile?.submittedAt ?? null,
        },
        200,
      );
    })
    .put("/draft", validate("json", draftInput), async (c) => {
      const { userId, revision, values: input } = c.req.valid("json");
      const db = c.var.db;
      const id = c.var.user.id;
      if (userId !== id)
        return c.json({ code: "ACCOUNT_CHANGED", message: "บัญชีที่เข้าสู่ระบบเปลี่ยนแปลงแล้ว" }, 403);
      const state = await readLockState(db, id);
      if (!state) return c.json({ message: "กรุณาเข้าสู่ระบบ" }, 401);
      // A locked institution is kept, whatever an older tab sends.
      const values = state.locked ? { ...input, institution: state.locked } : input;
      if (values.photoFileId) {
        const [photo] = await db
          .select({ id: uploadedFile.id })
          .from(uploadedFile)
          .where(
            and(
              eq(uploadedFile.id, values.photoFileId),
              eq(uploadedFile.ownerId, id),
              eq(uploadedFile.state, "ready"),
            ),
          );
        if (!photo) return c.json({ message: "เลือกรูปภาพที่อัปโหลดสำเร็จจากคลังของคุณ" }, 400);
      }
      // An absent profile is revision zero. The row stays after submission so a
      // late autosave can never recreate a just-submitted draft at revision zero.
      const unchanged = sql`coalesce((select ${userProfile.revision} from ${userProfile} where ${userProfile.userId} = ${id}), 0) = ${revision}`;
      // A lost response can be retried without advancing the revision again.
      // Only the exact last draft qualifies; a submission or newer edit cannot
      // be overwritten or mistaken for an acknowledgement of this save.
      const replay = sql`exists (select 1 from ${userProfile} where ${userProfile.userId} = ${id} and ${userProfile.revision} = ${revision + 1} and ${userProfile.dirty} = 1 and ${userProfile.draft} = ${JSON.stringify(values)})`;
      try {
        await db.batch([
          abortUnless(
            db,
            id,
            and(
              activeAccount(),
              institutionAsRead(state.institution),
              or(unchanged, replay),
              values.photoFileId ? ownedPhoto(values.photoFileId, id) : sql`1`,
            ) ?? sql`0`,
          ),
          db
            .insert(userProfile)
            .values({ userId: id, draft: values, revision: revision + 1, dirty: true })
            .onConflictDoUpdate({
              target: userProfile.userId,
              set: { draft: values, revision: revision + 1, dirty: true, updatedAt: new Date() },
              setWhere: eq(userProfile.revision, revision),
            }),
        ]);
      } catch (error) {
        if (constraintError(error) === "stale")
          return c.json({ message: "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่ก่อนบันทึก" }, 409);
        throw error;
      }
      return c.json({ revision: revision + 1 }, 200);
    })
    .post("/submit", validate("json", submitInput), async (c) => {
      const { userId, revision, values: input } = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      if (userId !== actor.id)
        return c.json({ code: "ACCOUNT_CHANGED", message: "บัญชีที่เข้าสู่ระบบเปลี่ยนแปลงแล้ว" }, 403);
      // Only the first submit sends the summary email; later edits do not.
      const before = await readLockState(db, actor.id);
      if (!before) return c.json({ message: "กรุณาเข้าสู่ระบบ" }, 401);
      // After the first submit the holder cannot change their institution.
      const values = before.locked ? { ...input, institution: before.locked } : input;
      const [photo] = await db
        .select()
        .from(uploadedFile)
        .where(
          and(
            eq(uploadedFile.id, values.photoFileId),
            eq(uploadedFile.ownerId, actor.id),
            eq(uploadedFile.state, "ready"),
          ),
        );
      if (
        !photo ||
        !PHOTO_TYPES.some((type) => type === photo.contentType) ||
        photo.size > MAX_PHOTO_SIZE
      )
        return c.json({ message: "เลือกรูปภาพของคุณที่อัปโหลดสำเร็จและมีขนาดไม่เกิน 10 MB" }, 400);
      const roles = parseRoles(actor.role);
      const role = roles.length === 1 && roles[0] === "guest" ? "participant" : actor.role;
      const now = new Date();
      try {
        await db.batch([
          abortUnless(
            db,
            actor.id,
            and(
              activeAccount(),
              eq(user.role, actor.role ?? "guest"),
              institutionAsRead(before.institution),
              sql`coalesce((select ${userProfile.revision} from ${userProfile} where ${userProfile.userId} = ${actor.id}), 0) = ${revision}`,
              ownedPhoto(photo.id, actor.id),
            ) ?? sql`0`,
          ),
          db
            .insert(userProfile)
            .values({
              userId: actor.id,
              draft: values,
              values,
              revision: revision + 1,
              dirty: false,
              submittedAt: now,
            })
            .onConflictDoUpdate({
              target: userProfile.userId,
              set: {
                draft: values,
                values,
                revision: revision + 1,
                dirty: false,
                submittedAt: sql`coalesce(${userProfile.submittedAt}, ${now.getTime()})`,
                updatedAt: now,
              },
            }),
          db
            .update(user)
            .set({
              role: role ?? "participant",
              name: `${values.firstName} ${values.lastName}`,
              image: new URL(`/api/files/public/${photo.id}`, c.req.url).href,
            })
            .where(eq(user.id, actor.id)),
        ]);
      } catch (error) {
        if (constraintError(error))
          return c.json({ message: "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่ก่อนบันทึก" }, 409);
        throw error;
      }
      if (!before.submittedAt) {
        await queueEmails(c, deps, [
          {
            kind: "profile-submitted",
            to: { email: before.email, name: `${values.firstName} ${values.lastName}` },
            profile: {
              prefix: values.prefix,
              firstName: values.firstName,
              lastName: values.lastName,
              nickname: values.nickname,
              phone: values.phone,
              institution: values.institution,
              medicalConditions: values.medicalConditions,
              drugAllergies: values.drugAllergies,
              foodAllergies: values.foodAllergies,
              dietaryRestrictions: values.dietaryRestrictions,
            },
          },
        ]);
      }
      return c.json({ revision: revision + 1 }, 200);
    });

export type ProfileRoutes = ReturnType<typeof createProfileRoutes>;
