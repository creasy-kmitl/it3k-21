import type { Session } from "@it3k/auth";
import { can } from "@it3k/auth/permissions";
import { department, user } from "@it3k/db/schema/index";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { createAuth, getDb } from "../services";

type Variables = {
  user: Session["user"];
};

const departmentInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
});

const requireSession = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const auth = await createAuth();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  if (session.user.banned) {
    return c.json({ message: "Forbidden" }, 403);
  }
  c.set("user", session.user);
  await next();
});

function isUniqueViolation(error: unknown) {
  const text = String(error) + String((error as { cause?: unknown })?.cause ?? "");
  return text.includes("UNIQUE constraint failed");
}

export const departments = new Hono<{ Variables: Variables }>()
  .use(requireSession)

  .get("/", async (c) => {
    if (!can(c.var.user.role, { department: ["read"] })) {
      return c.json({ message: "Forbidden" }, 403);
    }
    const db = getDb();
    const rows = await db
      .select({
        id: department.id,
        name: department.name,
        description: department.description,
        createdAt: department.createdAt,
        updatedAt: department.updatedAt,
        memberCount: count(user.id),
      })
      .from(department)
      .leftJoin(user, eq(user.departmentId, department.id))
      .groupBy(department.id)
      .orderBy(department.createdAt, department.name);
    return c.json(rows);
  })

  .get("/:id", async (c) => {
    if (!can(c.var.user.role, { department: ["read"] })) {
      return c.json({ message: "Forbidden" }, 403);
    }
    const db = getDb();
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
    return c.json(row);
  })

  .post("/", async (c) => {
    if (!can(c.var.user.role, { department: ["create"] })) {
      return c.json({ message: "Forbidden" }, 403);
    }
    const parsed = departmentInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ message: "Invalid input", issues: parsed.error.issues }, 400);
    }
    const db = getDb();
    try {
      const [row] = await db.insert(department).values(parsed.data).returning();
      return c.json(row, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return c.json({ message: "Department name already exists" }, 409);
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
    const db = getDb();
    try {
      const [row] = await db
        .update(department)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(department.id, id))
        .returning();
      if (!row) {
        return c.json({ message: "Department not found" }, 404);
      }
      return c.json(row);
    } catch (error) {
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
    const db = getDb();
    const [, deleted] = await db.batch([
      db.update(user).set({ departmentId: null }).where(eq(user.departmentId, id)),
      db.delete(department).where(eq(department.id, id)).returning({ id: department.id }),
    ]);
    if (deleted.length === 0) {
      return c.json({ message: "Department not found" }, 404);
    }
    return c.body(null, 204);
  })

  .put("/:id/members/:userId", async (c) => {
    if (!can(c.var.user.role, { department: ["assign"] })) {
      return c.json({ message: "Forbidden" }, 403);
    }
    const db = getDb();
    const target = await db.query.department.findFirst({ where: { id: c.req.param("id") } });
    if (!target) {
      return c.json({ message: "Department not found" }, 404);
    }
    const [row] = await db
      .update(user)
      .set({ departmentId: target.id })
      .where(eq(user.id, c.req.param("userId")))
      .returning({ id: user.id, departmentId: user.departmentId });
    if (!row) {
      return c.json({ message: "User not found" }, 404);
    }
    return c.json(row);
  })

  .delete("/:id/members/:userId", async (c) => {
    if (!can(c.var.user.role, { department: ["assign"] })) {
      return c.json({ message: "Forbidden" }, 403);
    }
    const db = getDb();
    const [row] = await db
      .update(user)
      .set({ departmentId: null })
      .where(and(eq(user.id, c.req.param("userId")), eq(user.departmentId, c.req.param("id"))))
      .returning({ id: user.id });
    if (!row) {
      return c.json({ message: "Member not found" }, 404);
    }
    return c.body(null, 204);
  });
