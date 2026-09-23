import type { Database } from "@it3k/db";
import { type DepartmentCode, department } from "@it3k/db/schema/department";
import { user } from "@it3k/db/schema/auth";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

/** Seams injected by index.ts in production and by tests in Bun. */
export type RouteDeps = {
  /** Resolves the session cookie to a user id, or null when signed out. */
  getUserId: (headers: Headers) => Promise<string | null>;
  getDb: () => Database;
};

export type CurrentUser = {
  id: string;
  name: string;
  role: string | null;
  departmentId: string | null;
  departmentCode: DepartmentCode | null;
  banned: boolean;
};

export type CurrentUserEnv = {
  Variables: { user: CurrentUser; db: Database };
};

function isBanned(row: { banned: boolean | null; banExpires: Date | null }) {
  if (!row.banned) return false;
  return row.banExpires === null || row.banExpires.getTime() > Date.now();
}

/**
 * Authenticates the request and loads the caller's role, department and ban
 * state from the database -- never from the client -- so authorization always
 * reflects the latest admin changes.
 */
export function requireUser(deps: RouteDeps) {
  return createMiddleware<CurrentUserEnv>(async (c, next) => {
    const userId = await deps.getUserId(c.req.raw.headers);
    if (!userId) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const db = deps.getDb();
    const [row] = await db
      .select({
        id: user.id,
        name: user.name,
        role: user.role,
        departmentId: user.departmentId,
        departmentCode: department.code,
        banned: user.banned,
        banExpires: user.banExpires,
      })
      .from(user)
      .leftJoin(department, eq(department.id, user.departmentId))
      .where(eq(user.id, userId));
    if (!row) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    if (isBanned(row)) {
      return c.json({ message: "Forbidden" }, 403);
    }
    c.set("db", db);
    c.set("user", {
      id: row.id,
      name: row.name,
      role: row.role,
      departmentId: row.departmentId,
      departmentCode: row.departmentCode,
      banned: false,
    });
    await next();
  });
}

/** Drizzle wraps driver errors; the SQLite message is on the cause chain. */
export function constraintError(error: unknown): "unique" | "foreign-key" | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes("UNIQUE constraint failed")) return "unique";
    if (message.includes("FOREIGN KEY constraint failed")) return "foreign-key";
    current = current instanceof Error ? current.cause : null;
  }
  return null;
}
