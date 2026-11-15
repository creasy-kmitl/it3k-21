// Audits for Better Auth's admin impersonation. evlog skips identifying users
// on /api/auth/** and Better Auth logs nothing of its own, so the route that
// forwards to the auth handler records who started and stopped acting as whom.
import {
  type Auth,
  IMPERSONATION_BLOCKED_PATHS,
  IMPERSONATION_FORBIDDEN,
  IMPERSONATION_MAX_AGE,
} from "@it3k/auth";
import type { Database } from "@it3k/db";
import { session } from "@it3k/db/schema/auth";
import { and, isNotNull, lt } from "drizzle-orm";
import type { AuditableLogger } from "evlog";

import { CLEAR_VIEW_AS_COOKIE } from "../middleware/view-as";

type AuditLog = Pick<AuditableLogger, "audit">;

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.clone().json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function field(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" ? found : null;
}

/**
 * Forwards to Better Auth, auditing impersonation as it starts, stops or is
 * refused, and ending any "view as" on sign-out.
 */
export async function handleAuthRequest(
  request: Request,
  auth: Auth,
  log: AuditLog | undefined,
): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");

  if (path === "/admin/stop-impersonating") {
    // Read who is being impersonated now: the response only carries the admin.
    const before = await auth.api
      .getSession({ headers: request.headers, query: { disableRefresh: true } })
      .catch(() => null);
    const res = await auth.handler(request);
    const adminId = before?.session.impersonatedBy;
    if (res.ok && adminId && before) {
      log?.audit({
        action: "admin.impersonation.stopped",
        actor: { type: "user", id: adminId },
        target: { type: "user", id: before.user.id },
      });
    }
    return res;
  }

  const res = await auth.handler(request);

  if (path === "/sign-out") {
    // A view chosen before signing out must not greet whoever signs in next.
    const headers = new Headers(res.headers);
    headers.append("set-cookie", CLEAR_VIEW_AS_COOKIE);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  if (path === "/admin/impersonate-user") {
    const body = await readJson(res);
    const started = body?.session;
    const adminId = field(started, "impersonatedBy");
    const targetId = field(started, "userId");
    if (res.ok && adminId && targetId) {
      log?.audit({
        action: "admin.impersonation.started",
        actor: { type: "user", id: adminId },
        target: { type: "user", id: targetId, sessionId: field(started, "id") ?? "" },
      });
    }
  } else if (res.status === 403 && IMPERSONATION_BLOCKED_PATHS.has(path)) {
    const body = await readJson(res);
    if (body?.code === IMPERSONATION_FORBIDDEN) {
      log?.audit.deny("Account endpoint called from an impersonated session", {
        action: `auth${path.replace(/\//g, ".")}`,
        actor: { type: "user", id: "impersonated-session" },
      });
    }
  }
  return res;
}

/**
 * Deletes impersonation sessions past IMPERSONATION_MAX_AGE. Requests already
 * refuse them; this keeps a forgotten one from lingering until Better Auth's
 * normal expiry. Run from the hourly cron.
 */
export async function cleanupImpersonationSessions(db: Database, now = Date.now()) {
  await db
    .delete(session)
    .where(
      and(
        isNotNull(session.impersonatedBy),
        lt(session.createdAt, new Date(now - IMPERSONATION_MAX_AGE * 1000)),
      ),
    );
}
