import type { Database } from "@it3k/db";
import { department } from "@it3k/db/schema/department";
import { user } from "@it3k/db/schema/auth";
import type { Institution } from "@it3k/db/profile";
import { type LeadershipRole, leadership } from "@it3k/db/schema/leadership";
import { IMPERSONATION_MAX_AGE } from "@it3k/auth";
import { hasRole, isMember } from "@it3k/auth/permissions";
import { type SQL, eq, sql } from "drizzle-orm";
import type { AuditableLogger } from "evlog";
import { createMiddleware } from "hono/factory";

import { type ViewAs, readViewAs } from "./view-as";

/** Seams injected by index.ts in production and by tests in Bun. */
export type RouteDeps = {
  /** Resolves the session cookie, or null when signed out. */
  getSession: (headers: Headers) => Promise<SessionIdentity | null>;
  getDb: () => Database;
  /** Signs the "view as" cookie (middleware/view-as.ts). */
  viewAsSecret: string;
};

export type SessionIdentity = {
  userId: string;
  /** Set when an admin is impersonating `userId` (Better Auth admin plugin). */
  impersonatedBy: string | null;
  /** When the session began; an impersonation ends IMPERSONATION_MAX_AGE later. */
  createdAt: Date;
};

export type CurrentUser = {
  id: string;
  impersonatedBy: string | null;
  name: string;
  role: string | null;
  /** The seat the account holds, if any; seats are what make someone a leader. */
  leadershipRole: LeadershipRole | null;
  departmentId: string | null;
  /** Any department code; only reserved ones grant rights (policies/department-capabilities.ts). */
  departmentCode: string | null;
  /** Scopes registration staff in the sport system (policies/sports.ts). */
  institution: Institution | null;
  banned: boolean;
  /**
   * An admin viewing the app as the role, department and institution above
   * ("view as"). `id` is still the admin's own, and every write is refused.
   */
  simulated: boolean;
};

export type CurrentUserEnv = {
  // `log` is set by the evlog middleware that index.ts mounts in front of every
  // route; it is absent when the routes run on their own in tests.
  Variables: { user: CurrentUser; db: Database; log?: AuditableLogger };
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
    return c.json({ message: "คำขอต้องส่งเป็น JSON (Content-Type: application/json)" }, 415);
  }
  await next();
});

export function isBanned(row: { banned: boolean | null; banExpires: Date | null }) {
  if (!row.banned) return false;
  return row.banExpires === null || row.banExpires.getTime() > Date.now();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The admin behind an impersonated session, if they may still act as one. */
async function impersonatorMayAct(db: Database, adminId: string) {
  const [row] = await db
    .select({ role: user.role, banned: user.banned, banExpires: user.banExpires })
    .from(user)
    .where(eq(user.id, adminId));
  return !!row && hasRole(row.role, "admin") && !isBanned(row);
}

/** The caller as the admin chose to view the app ("view as"). */
async function applyViewAs(db: Database, actor: CurrentUser, view: ViewAs): Promise<CurrentUser> {
  let departmentId: string | null = null;
  let departmentCode: string | null = null;
  if (view.departmentId) {
    // A department deleted since the view was chosen leaves the view without one.
    const [row] = await db
      .select({ id: department.id, code: department.code })
      .from(department)
      .where(eq(department.id, view.departmentId));
    departmentId = row?.id ?? null;
    departmentCode = row?.code ?? null;
  }
  const seat = view.kind === "head" || view.kind === "vicehead" ? view.kind : null;
  return {
    ...actor,
    role: seat ? "staff" : view.kind,
    leadershipRole: seat,
    departmentId,
    departmentCode,
    institution: view.institution,
    simulated: true,
  };
}

/**
 * Authenticates the request and loads the caller's role, department and ban
 * state from the database -- never from the client -- so authorization always
 * reflects the latest admin changes.
 *
 * Two admin tools change who that caller is:
 * - Impersonation (Better Auth admin plugin): the session belongs to the
 *   target, so the target's row is loaded. It is honoured only while the admin
 *   behind it is still an unbanned admin and for IMPERSONATION_MAX_AGE after it
 *   began, whatever expiry Better Auth's own refresh gives the session.
 * - "View as" (middleware/view-as.ts): an admin's signed cookie replaces their
 *   role, department, seat and institution, and every write is refused. Routes
 *   that manage the view itself pass `{ viewAs: "ignore" }` to see the admin.
 */
export function requireUser(deps: RouteDeps, options: { viewAs?: "apply" | "ignore" } = {}) {
  return createMiddleware<CurrentUserEnv>(async (c, next) => {
    const session = await deps.getSession(c.req.raw.headers);
    if (!session) {
      return c.json({ message: "กรุณาเข้าสู่ระบบ" }, 401);
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
        institution: user.institution,
        banned: user.banned,
        banExpires: user.banExpires,
      })
      .from(user)
      .leftJoin(department, eq(department.id, user.departmentId))
      .leftJoin(leadership, eq(leadership.userId, user.id))
      .where(eq(user.id, session.userId));
    if (!row) {
      return c.json({ message: "กรุณาเข้าสู่ระบบ" }, 401);
    }
    if (isBanned(row)) {
      return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
    }
    if (session.impersonatedBy) {
      if (session.createdAt.getTime() + IMPERSONATION_MAX_AGE * 1000 <= Date.now()) {
        return c.json({ message: "หมดเวลาสวมบัญชี กรุณากลับสู่บัญชีของคุณ" }, 401);
      }
      if (!(await impersonatorMayAct(db, session.impersonatedBy))) {
        return c.json({ message: "บัญชีผู้ดูแลที่สวมบัญชีนี้ไม่มีสิทธิ์แล้ว กรุณากลับสู่บัญชีของคุณ" }, 401);
      }
    }
    let current: CurrentUser = {
      id: row.id,
      impersonatedBy: session.impersonatedBy,
      name: row.name,
      role: row.role,
      leadershipRole: row.leadershipRole,
      departmentId: row.departmentId,
      departmentCode: row.departmentCode,
      institution: row.institution,
      banned: false,
      simulated: false,
    };
    if (options.viewAs !== "ignore" && !session.impersonatedBy && hasRole(row.role, "admin")) {
      const view = await readViewAs(c, deps.viewAsSecret);
      if (view && view.by === row.id) current = await applyViewAs(db, current, view);
    }
    if (current.impersonatedBy || current.simulated) {
      // Every request, reads included, so what an admin opened as someone else
      // -- a profile with health details, private files -- can be traced.
      c.get("log")?.set({
        auth: { impersonatedBy: current.impersonatedBy, viewAs: current.simulated },
      });
    }
    if (current.simulated && !SAFE_METHODS.has(c.req.method)) {
      return c.json({ message: "โหมดจำลองมุมมองดูได้อย่างเดียว ออกจากโหมดจำลองก่อนแก้ไข" }, 403);
    }
    c.set("db", db);
    c.set("user", current);
    await next();
  });
}

/** Staff resources require membership; profile and files use requireUser alone. */
export const requireMember = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!isMember(c.var.user.role)) {
    return c.json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" }, 403);
  }
  await next();
});

/** Drizzle wraps driver errors; the SQLite message is on the cause chain. */
export function constraintMessage(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current);
    if (/(UNIQUE|FOREIGN KEY|NOT NULL) constraint failed|department_code_protected/.test(message)) {
      return message;
    }
    current = current instanceof Error ? current.cause : null;
  }
  return null;
}

export function constraintError(
  error: unknown,
): "unique" | "foreign-key" | "stale" | "protected" | null {
  const message = constraintMessage(error);
  // Raised by the lock_department_codes triggers.
  if (message?.includes("department_code_protected")) return "protected";
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
