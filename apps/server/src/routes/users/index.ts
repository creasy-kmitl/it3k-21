import { hasRole, primaryRole } from "@it3k/auth/permissions";
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { HOST_INSTITUTION, INSTITUTION_IDS } from "@it3k/db/profile";
import { department, departmentAppearance } from "@it3k/db/schema/department";
import { leadership, leadershipSocial } from "@it3k/db/schema/leadership";
import { DEPARTMENT_KINDS, roleForKind } from "@it3k/db/invitation-rules";
import { type SQL, and, eq, notExists, sql } from "drizzle-orm";
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
import {
  NOT_HOST_SEAT,
  PAGE_SIZE,
  containsAny,
  mayHoldSeat,
  mayHoldSeatSql,
  seatIsAsRead,
  userQuery,
} from "../leadership";
import {
  assignableKinds,
  assignerIsAsRead,
  canAssign,
  canChangeAccount,
  canGrantAdmin,
  hasFullAssignRights,
  isManager,
  managerIsAsRead,
} from "../../policies/leadership";
import { validate } from "../../middleware/validation";
import { canManageDepartments } from "../../policies/departments";
import { canSendEmail } from "../../policies/email";
import { canSport, sportAccessIsAsRead, sportAccessJson } from "../../policies/sports";
import { usedBytes } from "../files";
import { limitJsonBody } from "../../middleware/json-body-limit";

const idParam = z.strictObject({ id: z.string().min(1) });

const assignmentInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["guest", "participant", "athlete"]) }),
  z.strictObject({
    kind: z.enum(DEPARTMENT_KINDS),
    departmentId: z.string().trim().min(1),
  }),
]);

const adminInput = z.strictObject({ admin: z.boolean() });

const institutionInput = z.strictObject({ institution: z.enum(INSTITUTION_IDS).nullable() });

function selectAccounts(db: Database) {
  return db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      role: user.role,
      institution: user.institution,
      storageLimit: user.storageLimit,
      storageUsed: usedBytes(user.id),
      departmentId: department.id,
      departmentName: department.name,
      departmentIcon: department.icon,
      departmentColor: department.color,
      seatRole: leadership.role,
    })
    .from(user)
    .leftJoin(department, eq(department.id, user.departmentId))
    .leftJoin(leadership, eq(leadership.userId, user.id));
}

type AccountRow = Awaited<ReturnType<ReturnType<typeof selectAccounts>["all"]>>[number];

function toAccount(row: AccountRow, actor: CurrentUser) {
  const role = primaryRole(row.role);
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    role,
    institution: row.institution,
    storageLimit: row.storageLimit,
    storageUsed: row.storageUsed,
    department:
      row.departmentId && row.departmentName
        ? departmentAppearance({
            id: row.departmentId,
            name: row.departmentName,
            icon: row.departmentIcon,
            color: row.departmentColor,
          })
        : null,
    seatRole: row.seatRole,
    // Only admins may change an admin's account; guest-only staff may change
    // only accounts that are neither members nor seat holders.
    canEdit: canAssign(actor, "guest", { role: row.role, seatRole: row.seatRole }),
    canSetInstitution: canSport(actor, "users.setInstitution") && canChangeAccount(actor, row.role),
    canSetStorage: hasFullAssignRights(actor) && canChangeAccount(actor, row.role),
    // An admin acting as themselves may act as any other non-admin account.
    canImpersonate: canImpersonate(actor, row),
  };
}

function canImpersonate(actor: CurrentUser, row: Pick<AccountRow, "id" | "role">) {
  return (
    hasRole(actor.role, "admin") &&
    !actor.impersonatedBy &&
    !actor.simulated &&
    row.id !== actor.id &&
    !hasRole(row.role, "admin")
  );
}

/** The department a "view as" names, shaped like an account's. */
async function viewedDepartment(db: Database, id: string | null) {
  if (!id) return null;
  const [row] = await db
    .select({
      id: department.id,
      name: department.name,
      icon: department.icon,
      color: department.color,
    })
    .from(department)
    .where(eq(department.id, id));
  return row ? departmentAppearance(row) : null;
}

async function findAccount(db: Database, id: string, actor: CurrentUser) {
  const [row] = await selectAccounts(db).where(eq(user.id, id));
  return row ? toAccount(row, actor) : null;
}

/** Storage quotas: admins and the heads and viceheads of Tech/Live and ทะเบียน. */
const fullRightsOnly = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!hasFullAssignRights(c.var.user)) {
    return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
  }
  await next();
});

const managerOnly = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!isManager(c.var.user)) {
    return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
  }
  await next();
});

export const createUserRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)
    .use(limitJsonBody)

    // The caller's own role, department and seat, read fresh for the nav.
    .get("/me", async (c) => {
      const actor = c.var.user;
      const account = await findAccount(c.var.db, actor.id, actor);
      if (!account) return c.json({ message: "กรุณาเข้าสู่ระบบ" }, 401);
      // While viewing as someone, the nav shows who the admin is viewing as.
      const view = actor.simulated
        ? {
            role: primaryRole(actor.role),
            department: await viewedDepartment(c.var.db, actor.departmentId),
            seatRole: actor.leadershipRole,
            institution: actor.institution,
          }
        : null;
      return c.json(
        {
          id: account.id,
          role: view?.role ?? account.role,
          department: view ? view.department : account.department,
          seatRole: view ? view.seatRole : account.seatRole,
          canManageUsers: isManager(actor),
          canManageDepartments: canManageDepartments(actor),
          // Kinds the caller may give, on the users page and in invitations.
          assignableKinds: assignableKinds(actor),
          institution: view ? view.institution : account.institution,
          sportAccess: sportAccessJson(actor),
          canSendEmail: canSendEmail(actor),
          viewingAs: actor.simulated,
        },
        200,
      );
    })

    .get("/", managerOnly, validate("query", userQuery), async (c) => {
      const { q, departmentId, page } = c.req.valid("query");
      const filters: SQL[] = [];
      if (departmentId) filters.push(eq(user.departmentId, departmentId));
      if (q) filters.push(containsAny([user.name], q));
      const rows = await selectAccounts(c.var.db)
        .where(and(...filters))
        .orderBy(user.name, user.id)
        .limit(PAGE_SIZE + 1)
        .offset((page - 1) * PAGE_SIZE);
      return c.json(
        {
          items: rows.slice(0, PAGE_SIZE).map((row) => toAccount(row, c.var.user)),
          page,
          hasMore: rows.length > PAGE_SIZE,
          canGrantAdmin: canGrantAdmin(c.var.user),
          assignableKinds: assignableKinds(c.var.user),
        },
        200,
      );
    })

    /**
     * Makes an account a guest, an athlete, staff of a department, or the head/vicehead of
     * one. Leaving a seat deletes it; taking an occupied seat replaces its
     * holder, who stays on as staff of that department.
     */
    .put(
      "/:id/assignment",
      managerOnly,
      validate("param", idParam),
      validate("json", assignmentInput),
      async (c) => {
        const { id } = c.req.valid("param");
        const input = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;

        const [target] = await db
          .select({ id: user.id, name: user.name, role: user.role, institution: user.institution })
          .from(user)
          .where(eq(user.id, id));
        if (!target) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
        const isAdmin = hasRole(target.role, "admin");
        if (!canChangeAccount(actor, target.role)) {
          return c.json({ message: "เฉพาะผู้ดูแลระบบที่แก้ไขบัญชีของผู้ดูแลระบบได้" }, 403);
        }

        const departmentId = "departmentId" in input ? input.departmentId : null;
        if (departmentId) {
          const [found] = await db
            .select({ id: department.id })
            .from(department)
            .where(eq(department.id, departmentId));
          if (!found) return c.json({ message: "ไม่พบฝ่ายนี้" }, 404);
        }

        const [current] = await db
          .select({
            id: leadership.id,
            departmentId: leadership.departmentId,
            role: leadership.role,
          })
          .from(leadership)
          .where(eq(leadership.userId, id));
        if (!canAssign(actor, input.kind, { role: target.role, seatRole: current?.role ?? null })) {
          return c.json({ message: "คุณกำหนดบทบาทนี้ให้บัญชีนี้ไม่ได้" }, 403);
        }
        const seatRole = input.kind === "head" || input.kind === "vicehead" ? input.kind : null;
        if (seatRole && !mayHoldSeat(target.institution)) {
          return c.json({ message: NOT_HOST_SEAT }, 400);
        }
        const keepsSeat =
          current !== undefined &&
          current.departmentId === departmentId &&
          current.role === seatRole;

        const [taken] =
          seatRole && departmentId && !keepsSeat
            ? await db
                .select({ id: leadership.id, userId: leadership.userId })
                .from(leadership)
                .where(
                  and(eq(leadership.departmentId, departmentId), eq(leadership.role, seatRole)),
                )
            : [];

        // Everything the writes below rely on, rechecked inside the batch: the
        // role decides admin rights, and the seats say whose data gets deleted.
        // keepsSeat compared the current seat's department and role, and the
        // seat to take over was found by them, so both are rechecked as read.
        const unchanged = and(
          eq(user.role, target.role),
          seatRole ? mayHoldSeatSql() : undefined,
          current
            ? seatIsAsRead(db, { ...current, userId: id })
            : notExists(
                db.select({ id: leadership.id }).from(leadership).where(eq(leadership.userId, id)),
              ),
          taken && seatRole && departmentId
            ? seatIsAsRead(db, { ...taken, departmentId, role: seatRole })
            : sql`1`,
        );

        try {
          // One batch: D1 applies it all or nothing, and abortUnless fails it if
          // anything read above changed. Seats are freed before one is taken so
          // the one-seat-per-account and one-holder-per-seat indexes hold.
          await db.batch([
            abortUnless(db, actor.id, assignerIsAsRead(actor)),
            abortUnless(db, id, unchanged ?? sql`1`),
            db
              .update(user)
              .set({
                departmentId,
                // Seats are not account roles: a head or vicehead is staff.
                role: isAdmin ? target.role : roleForKind(input.kind),
                // Seats are KMITL's; mayHoldSeat refused any other institution above.
                ...(seatRole
                  ? { institution: sql`coalesce(${user.institution}, ${HOST_INSTITUTION})` }
                  : {}),
              })
              .where(eq(user.id, id)),
            ...(current && !keepsSeat
              ? [
                  db.delete(leadershipSocial).where(eq(leadershipSocial.leadershipId, current.id)),
                  db.delete(leadership).where(eq(leadership.id, current.id)),
                ]
              : []),
            ...(taken
              ? [
                  // The previous holder's contact details are theirs, not the seat's.
                  db.delete(leadershipSocial).where(eq(leadershipSocial.leadershipId, taken.id)),
                  db
                    .update(leadership)
                    .set({
                      userId: id,
                      name: target.name,
                      nickname: null,
                      phone: null,
                      updatedAt: new Date(),
                    })
                    .where(eq(leadership.id, taken.id)),
                ]
              : []),
            ...(seatRole && departmentId && !keepsSeat && !taken
              ? [
                  db
                    .insert(leadership)
                    .values({ departmentId, role: seatRole, userId: id, name: target.name }),
                ]
              : []),
          ]);
        } catch (error) {
          if (constraintError(error)) {
            return c.json({ message: "ข้อมูลถูกแก้ไขระหว่างที่คุณกำลังแก้ กรุณาโหลดใหม่แล้วลองอีกครั้ง" }, 409);
          }
          throw error;
        }

        const account = await findAccount(db, id, actor);
        if (!account) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
        return c.json(account, 200);
      },
    )

    .put(
      "/:id/storage",
      fullRightsOnly,
      validate("param", idParam),
      validate(
        "json",
        z.strictObject({
          storageLimit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          expectedLimit: z.number().int().nonnegative(),
        }),
      ),
      async (c) => {
        const db = c.var.db;
        const actor = c.var.user;
        const { id } = c.req.valid("param");
        const { storageLimit, expectedLimit } = c.req.valid("json");
        const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, id));
        if (!target) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
        if (!canChangeAccount(actor, target.role))
          return c.json({ message: "เฉพาะผู้ดูแลระบบที่แก้ไขบัญชีของผู้ดูแลระบบได้" }, 403);
        try {
          await db.batch([
            abortUnless(db, actor.id, assignerIsAsRead(actor)),
            abortUnless(
              db,
              id,
              and(eq(user.role, target.role), eq(user.storageLimit, expectedLimit)) ?? sql`0`,
            ),
            db.update(user).set({ storageLimit }).where(eq(user.id, id)),
          ]);
        } catch (error) {
          if (constraintError(error))
            return c.json({ message: "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่" }, 409);
          throw error;
        }
        const account = await findAccount(db, id, actor);
        if (!account) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
        return c.json(account, 200);
      },
    )
    // The institution scopes what registration staff see in the sport system.
    .put(
      "/:id/institution",
      validate("param", idParam),
      validate("json", institutionInput),
      async (c) => {
        const db = c.var.db;
        const actor = c.var.user;
        const { id } = c.req.valid("param");
        const { institution } = c.req.valid("json");
        if (!canSport(actor, "users.setInstitution")) {
          return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
        }
        const [target] = await db
          .select({ role: user.role, seat: leadership.id })
          .from(user)
          .leftJoin(leadership, eq(leadership.userId, user.id))
          .where(eq(user.id, id));
        if (!target) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
        if (!canChangeAccount(actor, target.role)) {
          return c.json({ message: "เฉพาะผู้ดูแลระบบที่แก้ไขบัญชีของผู้ดูแลระบบได้" }, 403);
        }
        // Heads and viceheads are KMITL's; another institution would unseat them silently.
        const leavesHost = institution !== HOST_INSTITUTION;
        if (leavesHost && target.seat) return c.json({ message: NOT_HOST_SEAT }, 400);
        try {
          await db.batch([
            abortUnless(db, actor.id, sportAccessIsAsRead(actor)),
            abortUnless(
              db,
              id,
              and(
                eq(user.role, target.role),
                leavesHost
                  ? notExists(
                      db
                        .select({ id: leadership.id })
                        .from(leadership)
                        .where(eq(leadership.userId, id)),
                    )
                  : undefined,
              ) ?? sql`0`,
            ),
            db.update(user).set({ institution }).where(eq(user.id, id)),
          ]);
        } catch (error) {
          if (constraintError(error))
            return c.json({ message: "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่" }, 409);
          throw error;
        }
        const account = await findAccount(db, id, actor);
        if (!account) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
        return c.json(account, 200);
      },
    )
    .put("/:id/admin", validate("param", idParam), validate("json", adminInput), async (c) => {
      const { id } = c.req.valid("param");
      const { admin } = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      if (!canGrantAdmin(actor)) {
        return c.json({ message: "เฉพาะผู้ดูแลระบบที่ให้หรือถอนสิทธิ์ผู้ดูแลระบบได้" }, 403);
      }
      if (!admin && id === actor.id) {
        return c.json({ message: "คุณถอนสิทธิ์ผู้ดูแลระบบของตัวเองไม่ได้" }, 400);
      }
      const [target] = await db
        .select({ departmentId: user.departmentId, role: user.role })
        .from(user)
        .where(eq(user.id, id));
      if (!target) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
      const role = admin ? "admin" : target.departmentId ? "staff" : "guest";
      try {
        await db.batch([
          // canGrantAdmin established that the snapshot role contains admin;
          // equality inside this guard prevents a revoked admin restoring it.
          abortUnless(db, actor.id, managerIsAsRead(actor)),
          abortUnless(
            db,
            id,
            and(
              eq(user.role, target.role),
              target.departmentId
                ? eq(user.departmentId, target.departmentId)
                : sql`${user.departmentId} is null`,
            ) ?? sql`0`,
          ),
          db.update(user).set({ role }).where(eq(user.id, id)),
        ]);
      } catch (error) {
        if (constraintError(error)) return c.json({ message: "ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่" }, 409);
        throw error;
      }
      const account = await findAccount(db, id, actor);
      if (!account) return c.json({ message: "ไม่พบผู้ใช้นี้" }, 404);
      return c.json(account, 200);
    });

export type UserRoutes = ReturnType<typeof createUserRoutes>;
