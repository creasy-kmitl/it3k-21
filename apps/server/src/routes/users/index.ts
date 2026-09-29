import { type Role, hasRole } from "@it3k/auth/permissions";
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { department, departmentAppearance } from "@it3k/db/schema/department";
import { LEADERSHIP_ROLES, leadership, leadershipSocial } from "@it3k/db/schema/leadership";
import { type SQL, and, eq, exists, isNull, notExists, sql } from "drizzle-orm";
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
import { PAGE_SIZE, containsAny, userQuery } from "../leadership";
import { canChangeAccount, canGrantAdmin, isManager } from "../../policies/leadership";
import { validate } from "../../middleware/validation";

const idParam = z.strictObject({ id: z.string().min(1) });

const assignmentInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["guest", "athlete"]) }),
  z.strictObject({
    kind: z.enum(["staff", ...LEADERSHIP_ROLES]),
    departmentId: z.string().trim().min(1),
  }),
]);

const adminInput = z.strictObject({ admin: z.boolean() });

/** The single account role shown for a stored (possibly comma-separated) role. */
function accountRole(role: string | null): Role {
  if (hasRole(role, "admin")) return "admin";
  if (hasRole(role, "staff")) return "staff";
  if (hasRole(role, "athlete")) return "athlete";
  return "guest";
}

function selectAccounts(db: Database) {
  return db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      role: user.role,
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
  const role = accountRole(row.role);
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    role,
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
    // Only admins may change an admin's account.
    canEdit: isManager(actor) && canChangeAccount(actor, row.role),
  };
}

async function findAccount(db: Database, id: string, actor: CurrentUser) {
  const [row] = await selectAccounts(db).where(eq(user.id, id));
  return row ? toAccount(row, actor) : null;
}

const managerOnly = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!isManager(c.var.user)) {
    return c.json({ message: "Forbidden" }, 403);
  }
  await next();
});

export const createUserRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)

    // The caller's own role, department and seat, read fresh for the nav.
    .get("/me", async (c) => {
      const actor = c.var.user;
      const account = await findAccount(c.var.db, actor.id, actor);
      if (!account) return c.json({ message: "Unauthorized" }, 401);
      return c.json(
        {
          id: account.id,
          role: account.role,
          department: account.department,
          seatRole: account.seatRole,
          canManageUsers: isManager(actor),
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
          .select({ id: user.id, name: user.name, role: user.role })
          .from(user)
          .where(eq(user.id, id));
        if (!target) return c.json({ message: "User not found" }, 404);
        const isAdmin = hasRole(target.role, "admin");
        if (!canChangeAccount(actor, target.role)) {
          return c.json({ message: "Only admins can change an admin's account" }, 403);
        }

        const departmentId = "departmentId" in input ? input.departmentId : null;
        if (departmentId) {
          const [found] = await db
            .select({ id: department.id })
            .from(department)
            .where(eq(department.id, departmentId));
          if (!found) return c.json({ message: "Department not found" }, 404);
        }

        const [current] = await db
          .select({
            id: leadership.id,
            departmentId: leadership.departmentId,
            role: leadership.role,
          })
          .from(leadership)
          .where(eq(leadership.userId, id));
        const seatRole = input.kind === "head" || input.kind === "vicehead" ? input.kind : null;
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
        const heldBy = (seatId: string, holder: string | null) =>
          exists(
            db
              .select({ id: leadership.id })
              .from(leadership)
              .where(
                and(
                  eq(leadership.id, seatId),
                  holder === null ? isNull(leadership.userId) : eq(leadership.userId, holder),
                ),
              ),
          );
        const unchanged = and(
          eq(user.role, target.role),
          current
            ? heldBy(current.id, id)
            : notExists(
                db.select({ id: leadership.id }).from(leadership).where(eq(leadership.userId, id)),
              ),
          taken ? heldBy(taken.id, taken.userId) : sql`1`,
        );

        try {
          // One batch: D1 applies it all or nothing, and abortUnless fails it if
          // anything read above changed. Seats are freed before one is taken so
          // the one-seat-per-account and one-holder-per-seat indexes hold.
          await db.batch([
            abortUnless(db, id, unchanged ?? sql`1`),
            db
              .update(user)
              .set({
                departmentId,
                // Seats are not account roles: a head or vicehead is staff.
                role: isAdmin
                  ? target.role
                  : input.kind === "guest" || input.kind === "athlete"
                    ? input.kind
                    : "staff",
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
            return c.json(
              { message: "This changed while you were editing; reload and try again" },
              409,
            );
          }
          throw error;
        }

        const account = await findAccount(db, id, actor);
        if (!account) return c.json({ message: "User not found" }, 404);
        return c.json(account, 200);
      },
    )

    .put("/:id/admin", validate("param", idParam), validate("json", adminInput), async (c) => {
      const { id } = c.req.valid("param");
      const { admin } = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      if (!canGrantAdmin(actor)) {
        return c.json({ message: "Only admins can grant or remove admin" }, 403);
      }
      if (!admin && id === actor.id) {
        return c.json({ message: "You cannot remove your own admin role" }, 400);
      }
      const [target] = await db
        .select({ departmentId: user.departmentId })
        .from(user)
        .where(eq(user.id, id));
      if (!target) return c.json({ message: "User not found" }, 404);
      const role = admin ? "admin" : target.departmentId ? "staff" : "guest";
      await db.update(user).set({ role }).where(eq(user.id, id));
      const account = await findAccount(db, id, actor);
      if (!account) return c.json({ message: "User not found" }, 404);
      return c.json(account, 200);
    });

export type UserRoutes = ReturnType<typeof createUserRoutes>;
