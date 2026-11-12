import { can } from "@it3k/auth/permissions";
import {
  DEPARTMENT_CODE_MAX_LENGTH,
  DEPARTMENT_CODE_PATTERN,
  DEPARTMENT_COLORS,
  DEPARTMENT_ICONS,
  RESERVED_DEPARTMENT_CODES,
  department,
  departmentAppearance,
  leadership,
  user,
} from "@it3k/db/schema/index";
import { and, count, eq, ne, notExists, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUserEnv,
  type CurrentUser,
  type RouteDeps,
  abortUnless,
  constraintError,
  constraintMessage,
  requireJsonPosts,
  requireUser,
} from "../../middleware/current-user";
import { limitJsonBody } from "../../middleware/json-body-limit";
import { activeAccount } from "../profile";

const departmentInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  icon: z.enum(DEPARTMENT_ICONS).optional(),
  color: z.enum(DEPARTMENT_COLORS).optional(),
});

// Set once, here; PATCH cannot change it (departmentInput has no code).
// Reserved codes grant rights, so only a migration may hand one out.
const createInput = departmentInput.extend({
  // A blank code means none.
  code: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .trim()
      .max(DEPARTMENT_CODE_MAX_LENGTH)
      .regex(DEPARTMENT_CODE_PATTERN, "Use lowercase letters, digits and single hyphens")
      .refine(
        (code) => !(RESERVED_DEPARTMENT_CODES as readonly string[]).includes(code),
        "This code is reserved",
      )
      .nullish(),
  ),
});

const HAS_CODE = "A department with a code cannot be deleted";
const HOLDS_SEAT = "This account holds a head/vicehead seat; detach it from the seat first";

function isUniqueViolation(error: unknown) {
  return constraintError(error) === "unique";
}

// The role granted the department permission above; require that exact role
// and an active account again before any mutation, including self-assignment.
function stillAuthorized(actor: CurrentUser) {
  return and(activeAccount(), eq(user.role, actor.role ?? "")) ?? sql`0`;
}

const STALE = "Permissions or data changed; reload and try again";

export const createDepartmentRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(limitJsonBody)

    .get("/", async (c) => {
      if (!can(c.var.user.role, { department: ["read"] })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const db = c.var.db;
      const rows = await db
        .select({
          id: department.id,
          name: department.name,
          description: department.description,
          code: department.code,
          icon: department.icon,
          color: department.color,
          createdAt: department.createdAt,
          updatedAt: department.updatedAt,
          memberCount: count(user.id),
        })
        .from(department)
        .leftJoin(user, eq(user.departmentId, department.id))
        .groupBy(department.id)
        .orderBy(department.createdAt, department.name);
      return c.json(rows.map(departmentAppearance));
    })

    .get("/:id", async (c) => {
      if (!can(c.var.user.role, { department: ["read"] })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const db = c.var.db;
      const row = await db.query.department.findFirst({
        where: { id: c.req.param("id") },
        with: {
          members: {
            columns: { id: true, name: true, email: true, image: true, role: true },
            orderBy: { name: "asc" },
          },
        },
      });
      if (!row) {
        return c.json({ message: "Department not found" }, 404);
      }
      return c.json(departmentAppearance(row));
    })

    .post("/", async (c) => {
      if (!can(c.var.user.role, { department: ["create"] })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const parsed = createInput.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ message: "Invalid input", issues: parsed.error.issues }, 400);
      }
      const db = c.var.db;
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, stillAuthorized(c.var.user)),
          db
            .insert(department)
            .values({ ...parsed.data, code: parsed.data.code ?? null })
            .returning(),
        ]);
        const [row] = rows;
        if (!row) throw new Error("Department insert returned no row");
        return c.json(departmentAppearance(row), 201);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (isUniqueViolation(error)) {
          return constraintMessage(error)?.includes("department.code")
            ? c.json({ message: "Another department already has this code" }, 409)
            : c.json({ message: "Department name already exists" }, 409);
        }
        throw error;
      }
    })

    .patch("/:id", async (c) => {
      if (!can(c.var.user.role, { department: ["update"] })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const id = c.req.param("id");
      const parsed = departmentInput.partial().safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ message: "Invalid input", issues: parsed.error.issues }, 400);
      }
      const db = c.var.db;
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, stillAuthorized(c.var.user)),
          db
            .update(department)
            .set({ ...parsed.data, updatedAt: new Date() })
            .where(eq(department.id, id))
            .returning(),
        ]);
        const [row] = rows;
        if (!row) {
          return c.json({ message: "Department not found" }, 404);
        }
        return c.json(departmentAppearance(row));
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (isUniqueViolation(error)) {
          return c.json({ message: "Department name already exists" }, 409);
        }
        throw error;
      }
    })

    .delete("/:id", async (c) => {
      if (!can(c.var.user.role, { department: ["delete"] })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const id = c.req.param("id");
      const db = c.var.db;
      const hasLeaders = "Remove this department's head and vicehead before deleting it";
      // Codes are permanent ids, and some carry rights; the
      // lock_department_codes trigger refuses the delete too.
      const [target] = await db
        .select({ code: department.code })
        .from(department)
        .where(eq(department.id, id));
      if (target && target.code !== null) {
        return c.json({ message: HAS_CODE }, 409);
      }
      const [seat] = await db
        .select({ id: leadership.id })
        .from(leadership)
        .where(eq(leadership.departmentId, id))
        .limit(1);
      if (seat) {
        return c.json({ message: hasLeaders }, 409);
      }
      try {
        const [, , deleted] = await db.batch([
          abortUnless(db, c.var.user.id, stillAuthorized(c.var.user)),
          db.update(user).set({ departmentId: null }).where(eq(user.departmentId, id)),
          db.delete(department).where(eq(department.id, id)).returning({ id: department.id }),
        ]);
        if (deleted.length === 0) {
          return c.json({ message: "Department not found" }, 404);
        }
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        if (constraintError(error) === "protected") {
          return c.json({ message: HAS_CODE }, 409);
        }
        // A seat created between the check and the batch; the FK rolls it back.
        if (constraintError(error) === "foreign-key") {
          return c.json({ message: hasLeaders }, 409);
        }
        throw error;
      }
      return c.body(null, 204);
    })

    .put("/:id/members/:userId", async (c) => {
      if (!can(c.var.user.role, { department: ["assign"] })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const db = c.var.db;
      const target = await db.query.department.findFirst({ where: { id: c.req.param("id") } });
      if (!target) {
        return c.json({ message: "Department not found" }, 404);
      }
      const userId = c.req.param("userId");
      // A seat's account must stay in the seat's department. Checked in the
      // UPDATE itself so a seat attached meanwhile is still honoured.
      const seatElsewhere = db
        .select({ id: leadership.id })
        .from(leadership)
        .where(and(eq(leadership.userId, userId), ne(leadership.departmentId, target.id)));
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, stillAuthorized(c.var.user)),
          db
            .update(user)
            .set({ departmentId: target.id })
            .where(and(eq(user.id, userId), notExists(seatElsewhere)))
            .returning({ id: user.id, departmentId: user.departmentId }),
        ]);
        const [row] = rows;
        if (!row) {
          const [found] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
          return found
            ? c.json({ message: HOLDS_SEAT }, 409)
            : c.json({ message: "User not found" }, 404);
        }
        return c.json(row);
      } catch (error) {
        if (constraintError(error)) return c.json({ message: STALE }, 409);
        throw error;
      }
    })

    .delete("/:id/members/:userId", async (c) => {
      if (!can(c.var.user.role, { department: ["assign"] })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const db = c.var.db;
      const userId = c.req.param("userId");
      const member = and(eq(user.id, userId), eq(user.departmentId, c.req.param("id")));
      const seat = db
        .select({ id: leadership.id })
        .from(leadership)
        .where(eq(leadership.userId, userId));
      try {
        const [, rows] = await db.batch([
          abortUnless(db, c.var.user.id, stillAuthorized(c.var.user)),
          db
            .update(user)
            .set({ departmentId: null })
            .where(and(member, notExists(seat)))
            .returning({ id: user.id }),
        ]);
        const [row] = rows;
        if (!row) {
          const [found] = await db.select({ id: user.id }).from(user).where(member);
          return found
            ? c.json({ message: HOLDS_SEAT }, 409)
            : c.json({ message: "Member not found" }, 404);
        }
        return c.body(null, 204);
      } catch (error) {
        if (constraintError(error)) return c.json({ message: STALE }, 409);
        throw error;
      }
    });
