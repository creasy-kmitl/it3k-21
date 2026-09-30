import type { Database } from "@it3k/db";
import { type DepartmentCode, department } from "@it3k/db/schema/department";
import { user } from "@it3k/db/schema/auth";
import { type LeadershipRole, leadership } from "@it3k/db/schema/leadership";
import { isMember } from "@it3k/auth/permissions";
import { type SQL, eq, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

/** Seams injected by index.ts in production and by tests in Bun. */
export type RouteDeps = {
  /** Resolves the session cookie, or null when signed out. */
  getSession: (headers: Headers) => Promise<SessionIdentity | null>;
  getDb: () => Database;
};

export type SessionIdentity = {
  userId: string;
  /** Set when an admin is impersonating `userId` (Better Auth admin plugin). */
  impersonatedBy: string | null;
};

export type CurrentUser = {
  id: string;
  impersonatedBy: string | null;
  name: string;
  role: string | null;
  /** The seat the account holds, if any; seats are what make someone a leader. */
  leadershipRole: LeadershipRole | null;
  departmentId: string | null;
  departmentCode: DepartmentCode | null;
  banned: boolean;
};

export type CurrentUserEnv = {
  Variables: { user: CurrentUser; db: Database };
};

/**
 * CSRF guard. Session cookies are SameSite=None, so a page on another site
 * can make the browser send them. Of the methods these routes accept, only
 * POST can be sent cross-site without a CORS preflight -- and only with a
 * form-like content type -- so every POST must declare JSON. PATCH, PUT and
 * DELETE always preflight, which CORS_ORIGIN then restricts.
 */
export const requireJsonPosts = createMiddleware(async (c, next) => {
  const type = c.req.header("content-type") ?? "";
  if (c.req.method === "POST" && !/^application\/json\b/i.test(type)) {
    return c.json({ message: "Content-Type must be application/json" }, 415);
  }
  await next();
});

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
    const session = await deps.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const db = deps.getDb();
    const [row] = await db
      .select({
        id: user.id,
        name: user.name,
        role: user.role,
        leadershipRole: leadership.role,
        departmentId: user.departmentId,
        departmentCode: department.code,
        banned: user.banned,
        banExpires: user.banExpires,
      })
      .from(user)
      .leftJoin(department, eq(department.id, user.departmentId))
      .leftJoin(leadership, eq(leadership.userId, user.id))
      .where(eq(user.id, session.userId));
    if (!row) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    if (isBanned(row)) {
      return c.json({ message: "Forbidden" }, 403);
    }
    c.set("db", db);
    c.set("user", {
      id: row.id,
      impersonatedBy: session.impersonatedBy,
      name: row.name,
      role: row.role,
      leadershipRole: row.leadershipRole,
      departmentId: row.departmentId,
      departmentCode: row.departmentCode,
      banned: false,
    });
    await next();
  });
}

/** Guests (new sign-ins not yet made staff) get nothing past sign-in. */
export const requireMember = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!isMember(c.var.user.role)) {
    return c.json({ message: "Forbidden" }, 403);
  }
  await next();
});

/** Drizzle wraps driver errors; the SQLite message is on the cause chain. */
export function constraintMessage(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (/(UNIQUE|FOREIGN KEY|NOT NULL) constraint failed/.test(message)) return message;
    current = current instanceof Error ? current.cause : null;
  }
  return null;
}

export function constraintError(error: unknown): "unique" | "foreign-key" | "stale" | null {
  const message = constraintMessage(error);
  if (message?.includes("UNIQUE constraint failed")) return "unique";
  if (message?.includes("FOREIGN KEY constraint failed")) return "foreign-key";
  if (message?.includes("NOT NULL constraint failed: user.role")) return "stale";
  return null;
}

/**
 * A batch statement that fails the whole batch (a NOT NULL error on user.role,
 * reported by constraintError as "stale") unless the actor's account still
 * exists and `stillTrue` holds for it. D1 runs a batch as one transaction, so
 * this rechecks what the route read and rolls every write back if it changed
 * in between. Put it before any write in the batch that changes what it
 * checks. With `sql\`1\`` it changes nothing.
 *
 * It is an upsert so that a deleted account fails too: an UPDATE of a missing
 * row matches nothing and would let the batch through. When the account
 * exists, the insert conflicts on id and the update keeps or nulls the role.
 * When it does not, the insert proposes a NULL role and fails on its own.
 */
export function abortUnless(db: Database, userId: string, stillTrue: SQL) {
  const actorExists = sql`exists (select 1 from ${user} where ${user.id} = ${userId})`;
  return db
    .insert(user)
    .values({
      id: userId,
      name: "",
      // Never a real address, so it cannot clash with another account's.
      email: `abort-unless:${userId}`,
      role: sql`case when ${actorExists} then 'staff' else null end`,
    })
    .onConflictDoUpdate({
      target: user.id,
      // updatedAt is kept as is: this guard must not look like a change.
      set: {
        role: sql`case when ${stillTrue} then ${user.role} else null end`,
        updatedAt: sql`${user.updatedAt}`,
      },
    });
}

/** True while the account's (comma-separated) role list does not include admin. */
export function notAdmin(): SQL {
  return sql`',' || replace(${user.role}, ' ', '') || ',' not like '%,admin,%'`;
}
