// Invitations let an address outside the institution domains sign in for the
// first time (packages/auth/src/signup.ts) and say what its account becomes.
// Who may invite as what is the same rule as assignments (canAssign).
import type { Database } from "@it3k/db";
import {
  ASSIGN_KINDS,
  type AssignKind,
  INVITATION_TTL_MS,
  needsDepartment,
  normalizeEmail,
} from "@it3k/db/invitation-rules";
import { isOpen } from "@it3k/db/invitations";
import { HOST_INSTITUTION, INSTITUTION_IDS } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import { department } from "@it3k/db/schema/department";
import { invitation } from "@it3k/db/schema/invitation";
import { leadership } from "@it3k/db/schema/leadership";
import { alias } from "drizzle-orm/sqlite-core";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { type MailDeps, queueEmails } from "../../email/mailer";
import { limitJsonBody } from "../../middleware/json-body-limit";
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
import { validate } from "../../middleware/validation";
import { assignableKinds, assignerIsAsRead, canAssign, isManager } from "../../policies/leadership";
import { canSport, sportAccessIsAsRead } from "../../policies/sports";

/** How many invitations the list shows, newest first. */
export const INVITATION_LIST_LIMIT = 100;

const idParam = z.strictObject({ id: z.string().min(1) });

const createInput = z
  .strictObject({
    email: z.string().transform(normalizeEmail).pipe(z.email("อีเมลไม่ถูกต้อง").max(254)),
    kind: z.enum(ASSIGN_KINDS),
    departmentId: z.string().trim().min(1).nullable().optional(),
    // Needs users.setInstitution, the same right as setting it on an account.
    // Seats are KMITL's: a head or vicehead invitation is always KMITL's.
    institution: z.enum(INSTITUTION_IDS).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const seat = value.kind === "head" || value.kind === "vicehead";
    if (seat && value.institution && value.institution !== HOST_INSTITUTION) {
      ctx.addIssue({
        code: "custom",
        path: ["institution"],
        message: "หัวหน้าและรองหัวหน้าฝ่ายต้องเป็นบัญชีของ สจล. เท่านั้น",
      });
    }
    if (needsDepartment(value.kind) && !value.departmentId) {
      ctx.addIssue({ code: "custom", path: ["departmentId"], message: "เลือกฝ่าย" });
    }
    if (!needsDepartment(value.kind) && value.departmentId) {
      ctx.addIssue({ code: "custom", path: ["departmentId"], message: "บทบาทนี้ไม่มีฝ่าย" });
    }
  });

type Status = "pending" | "expired" | "accepted" | "revoked";

const inviter = alias(user, "inviter");

function selectInvitations(db: Database) {
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      kind: invitation.kind,
      institution: invitation.institution,
      departmentId: department.id,
      departmentName: department.name,
      invitedBy: inviter.name,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
    })
    .from(invitation)
    .leftJoin(department, eq(department.id, invitation.departmentId))
    .leftJoin(inviter, eq(inviter.id, invitation.invitedBy));
}

type Row = Awaited<ReturnType<ReturnType<typeof selectInvitations>["all"]>>[number];

function statusOf(row: Pick<Row, "acceptedAt" | "revokedAt" | "expiresAt">, now: number): Status {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  return row.expiresAt.getTime() > now ? "pending" : "expired";
}

function toInvitation(row: Row, actor: CurrentUser, now = Date.now()) {
  const status = statusOf(row, now);
  const open = status === "pending" || status === "expired";
  return {
    id: row.id,
    email: row.email,
    kind: row.kind,
    institution: row.institution,
    department:
      row.departmentId && row.departmentName
        ? { id: row.departmentId, name: row.departmentName }
        : null,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    status,
    // Resend (which also renews an expired one) and revoke.
    canManage: open && canAssign(actor, row.kind),
  };
}

async function findInvitation(db: Database, id: string) {
  const [row] = await selectInvitations(db).where(eq(invitation.id, id));
  return row;
}

async function accountExists(db: Database, email: string) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return !!row;
}

function invitationJob(row: Row) {
  return {
    kind: "invitation" as const,
    to: { email: row.email },
    invite: {
      kind: row.kind,
      department: row.departmentName,
      institution: row.institution,
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt.getTime(),
    },
  };
}

const managerOnly = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!isManager(c.var.user)) {
    return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
  }
  await next();
});

const forbidden = { message: "คุณเชิญด้วยบทบาทนี้ไม่ได้" };
const stale = { message: "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่" };
const hasAccount = { message: "อีเมลนี้มีบัญชีแล้ว เปลี่ยนบทบาทได้ที่รายชื่อผู้ใช้" };

export const createInvitationRoutes = (deps: RouteDeps & MailDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(managerOnly)
    .use(limitJsonBody)

    .get("/", async (c) => {
      const rows = await selectInvitations(c.var.db)
        .orderBy(desc(invitation.createdAt), invitation.id)
        .limit(INVITATION_LIST_LIMIT);
      const now = Date.now();
      return c.json(
        {
          items: rows.map((row) => toInvitation(row, c.var.user, now)),
          assignableKinds: assignableKinds(c.var.user),
          canSetInstitution: canSport(c.var.user, "users.setInstitution"),
        },
        200,
      );
    })

    .post("/", validate("json", createInput), async (c) => {
      const db = c.var.db;
      const actor = c.var.user;
      const { email, kind } = c.req.valid("json");
      const departmentId = c.req.valid("json").departmentId ?? null;
      const seatRole: AssignKind | null = kind === "head" || kind === "vicehead" ? kind : null;
      // Chosen by the inviter, which needs users.setInstitution; a seat's is fixed.
      const chosenInstitution = seatRole ? null : (c.req.valid("json").institution ?? null);
      const institution = seatRole ? HOST_INSTITUTION : chosenInstitution;
      if (!canAssign(actor, kind)) return c.json(forbidden, 403);
      if (chosenInstitution && !canSport(actor, "users.setInstitution")) {
        return c.json({ message: "คุณกำหนดสถาบันไม่ได้" }, 403);
      }
      if (await accountExists(db, email)) return c.json(hasAccount, 409);

      if (departmentId) {
        const [found] = await db
          .select({ id: department.id })
          .from(department)
          .where(eq(department.id, departmentId));
        if (!found) return c.json({ message: "ไม่พบฝ่ายนี้" }, 404);
      }
      if (seatRole && departmentId) {
        const [taken] = await db
          .select({ id: leadership.id })
          .from(leadership)
          .where(and(eq(leadership.departmentId, departmentId), eq(leadership.role, seatRole)));
        if (taken) return c.json({ message: "ตำแหน่งนี้มีคนดำรงอยู่แล้ว" }, 409);
      }

      const id = crypto.randomUUID();
      try {
        await db.batch([
          abortUnless(db, actor.id, assignerIsAsRead(actor)),
          ...(chosenInstitution ? [abortUnless(db, actor.id, sportAccessIsAsRead(actor))] : []),
          db.insert(invitation).values({
            id,
            email,
            kind,
            departmentId,
            institution,
            invitedBy: actor.id,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          }),
        ]);
      } catch (error) {
        const kindOfError = constraintError(error);
        if (kindOfError === "unique") return c.json({ message: "อีเมลนี้มีคำเชิญที่ยังเปิดอยู่แล้ว" }, 409);
        if (kindOfError === "foreign-key") return c.json({ message: "ไม่พบฝ่ายนี้" }, 404);
        if (kindOfError) return c.json(stale, 409);
        throw error;
      }

      const row = await findInvitation(db, id);
      if (!row) return c.json(stale, 409);
      await queueEmails(c, deps, [invitationJob(row)]);
      return c.json(toInvitation(row, actor), 201);
    })

    // Sends the email again and renews the invitation, expired or not.
    // An empty JSON body: requireJsonPosts refuses a POST without one.
    .post(
      "/:id/resend",
      validate("param", idParam),
      validate("json", z.strictObject({})),
      async (c) => {
        const db = c.var.db;
        const actor = c.var.user;
        const { id } = c.req.valid("param");
        const current = await findInvitation(db, id);
        if (!current) return c.json({ message: "ไม่พบคำเชิญนี้" }, 404);
        if (current.acceptedAt || current.revokedAt) {
          return c.json({ message: "คำเชิญนี้ปิดแล้ว" }, 409);
        }
        if (!canAssign(actor, current.kind)) return c.json(forbidden, 403);
        if (await accountExists(db, current.email)) return c.json(hasAccount, 409);
        try {
          await db.batch([
            abortUnless(db, actor.id, assignerIsAsRead(actor)),
            // Fails the batch if the invitation was accepted or revoked meanwhile.
            abortUnless(
              db,
              actor.id,
              sql`exists (select 1 from ${invitation} where ${invitation.id} = ${id} and ${isOpen()})`,
            ),
            db
              .update(invitation)
              .set({ expiresAt: new Date(Date.now() + INVITATION_TTL_MS) })
              .where(eq(invitation.id, id)),
          ]);
        } catch (error) {
          if (constraintError(error)) return c.json(stale, 409);
          throw error;
        }
        const row = await findInvitation(db, id);
        if (!row) return c.json({ message: "ไม่พบคำเชิญนี้" }, 404);
        await queueEmails(c, deps, [invitationJob(row)]);
        return c.json(toInvitation(row, actor), 200);
      },
    )

    .delete("/:id", validate("param", idParam), async (c) => {
      const db = c.var.db;
      const actor = c.var.user;
      const { id } = c.req.valid("param");
      const current = await findInvitation(db, id);
      if (!current) return c.json({ message: "ไม่พบคำเชิญนี้" }, 404);
      if (current.acceptedAt || current.revokedAt) {
        return c.json({ message: "คำเชิญนี้ปิดแล้ว" }, 409);
      }
      if (!canAssign(actor, current.kind)) return c.json(forbidden, 403);
      try {
        await db.batch([
          abortUnless(db, actor.id, assignerIsAsRead(actor)),
          abortUnless(
            db,
            actor.id,
            sql`exists (select 1 from ${invitation} where ${invitation.id} = ${id} and ${isOpen()})`,
          ),
          db.update(invitation).set({ revokedAt: new Date() }).where(eq(invitation.id, id)),
        ]);
      } catch (error) {
        if (constraintError(error)) return c.json(stale, 409);
        throw error;
      }
      const row = await findInvitation(db, id);
      if (!row) return c.json({ message: "ไม่พบคำเชิญนี้" }, 404);
      return c.json(toInvitation(row, actor), 200);
    });

export type InvitationRoutes = ReturnType<typeof createInvitationRoutes>;
