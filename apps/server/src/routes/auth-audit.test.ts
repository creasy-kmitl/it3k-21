// Better Auth itself, run against the test D1: the impersonation hooks in
// packages/auth and the audits handleAuthRequest records around them.
import { beforeEach, describe, expect, test } from "bun:test";
import { createAuth } from "@it3k/auth";
import { session } from "@it3k/db/schema/auth";
import { eq } from "drizzle-orm";

import { createTestContext } from "../testing";
import { cleanupImpersonationSessions, handleAuthRequest } from "./auth-audit";

const SECRET = "test-secret-test-secret-test-secret";
const ORIGIN = "http://localhost:3001";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let t: ReturnType<typeof createTestContext>;
let auth: ReturnType<typeof createAuth>;
let audits: { kind: "audit" | "deny"; input: Record<string, unknown> }[];
const log = {
  audit: Object.assign(
    (input: Record<string, unknown>) => {
      audits.push({ kind: "audit", input });
    },
    {
      deny: (reason: string, input: Record<string, unknown>) => {
        audits.push({ kind: "deny", input: { ...input, reason } });
      },
    },
  ),
} as unknown as Parameters<typeof handleAuthRequest>[2];

beforeEach(async () => {
  t = createTestContext();
  audits = [];
  auth = createAuth(
    {
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: SECRET,
      CORS_ORIGIN: ORIGIN,
      GOOGLE_CLIENT_ID: "test",
      GOOGLE_SECRET_ID: "test",
      AUTH_PROXY_URL: "http://localhost:3000",
    },
    t.db,
  );
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("admin-2", { role: "admin" });
  await t.seedUser("staff", { department: "Art" });
});

/** A session row plus the signed cookie Better Auth expects for it. */
async function seedSession(
  userId: string,
  options: { impersonatedBy?: string; createdAt?: Date; expiresAt?: Date } = {},
) {
  const token = `token-${userId}-${crypto.randomUUID()}`;
  const createdAt = options.createdAt ?? new Date();
  await t.db.insert(session).values({
    id: crypto.randomUUID(),
    token,
    userId,
    createdAt,
    updatedAt: createdAt,
    expiresAt: options.expiresAt ?? new Date(createdAt.getTime() + HOUR),
    impersonatedBy: options.impersonatedBy ?? null,
  });
  return { token, cookie: `better-auth.session_token=${await sign(token)}` };
}

/** better-call's signed cookie value: `value.base64(HMAC-SHA256(value))`, URL-encoded. */
async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const signature = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return encodeURIComponent(`${value}.${signature}`);
}

async function expiryOf(token: string) {
  const [row] = await t.db.select().from(session).where(eq(session.token, token));
  return row?.expiresAt.getTime() ?? 0;
}

function post(path: string, cookie: string, json: unknown = {}) {
  return handleAuthRequest(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(json),
    }),
    auth,
    log,
  );
}

/** The cookies a response sets, as one Cookie header. */
function cookiesFrom(res: Response) {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c && !c.endsWith("="))
    .join("; ");
}

describe("impersonation session expiry", () => {
  test("a routine refresh does not stretch it past its hour", async () => {
    const imp = await seedSession("staff", { impersonatedBy: "admin" });
    const before = await expiryOf(imp.token);
    const result = await auth.api.getSession({ headers: new Headers({ cookie: imp.cookie }) });
    expect(result?.session.impersonatedBy).toBe("admin");
    expect(await expiryOf(imp.token)).toBe(before);
  });

  test("an ordinary session with the same expiry is still refreshed", async () => {
    // Shows the refresh the hook holds back really would have happened.
    const own = await seedSession("staff");
    await auth.api.getSession({ headers: new Headers({ cookie: own.cookie }) });
    expect(await expiryOf(own.token)).toBeGreaterThan(Date.now() + 6 * DAY);
  });
});

describe("account endpoints while impersonating", () => {
  test("are refused, and the refusal is audited", async () => {
    const imp = await seedSession("staff", { impersonatedBy: "admin" });
    for (const [path, body] of [
      ["/update-user", { name: "Renamed" }],
      ["/link-social", { provider: "discord" }],
      ["/revoke-other-sessions", {}],
      ["/get-access-token", { providerId: "google" }],
    ] as const) {
      const res = await post(path, imp.cookie, body);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("IMPERSONATION_FORBIDDEN");
    }
    expect(audits.filter((a) => a.kind === "deny")).toHaveLength(4);
  });

  test("stay open to the account's own session", async () => {
    const own = await seedSession("staff");
    const res = await post("/update-user", own.cookie, { name: "Renamed" });
    expect(res.status).toBe(200);
    expect(audits).toEqual([]);
  });
});

describe("starting and stopping", () => {
  test("is audited with the admin as actor and the account as target", async () => {
    const admin = await seedSession("admin", { expiresAt: new Date(Date.now() + 7 * DAY) });
    const started = await post("/admin/impersonate-user", admin.cookie, { userId: "staff" });
    expect(started.status).toBe(200);
    expect(audits[0]?.input).toMatchObject({
      action: "admin.impersonation.started",
      actor: { type: "user", id: "admin" },
      target: { type: "user", id: "staff" },
    });

    const cookie = cookiesFrom(started);
    expect(cookie).toContain("admin_session");
    const stopped = await post("/admin/stop-impersonating", cookie);
    expect(stopped.status).toBe(200);
    expect(audits[1]?.input).toMatchObject({
      action: "admin.impersonation.stopped",
      actor: { type: "user", id: "admin" },
      target: { type: "user", id: "staff" },
    });
  });

  test("an admin cannot impersonate another admin", async () => {
    const admin = await seedSession("admin", { expiresAt: new Date(Date.now() + 7 * DAY) });
    const res = await post("/admin/impersonate-user", admin.cookie, { userId: "admin-2" });
    expect(res.status).toBe(403);
    expect(audits).toEqual([]);
  });

  test("a non-admin cannot impersonate anyone", async () => {
    const staff = await seedSession("staff", { expiresAt: new Date(Date.now() + 7 * DAY) });
    const res = await post("/admin/impersonate-user", staff.cookie, { userId: "admin" });
    expect(res.status).toBe(403);
  });
});

describe("signing out", () => {
  test("also ends any view-as", async () => {
    const own = await seedSession("admin", { expiresAt: new Date(Date.now() + 7 * DAY) });
    const res = await post("/sign-out", own.cookie);
    expect(res.status).toBe(200);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith("__Host-it3k_view_as="));
    expect(cleared).toContain("Max-Age=0");
    // Better Auth's own session cookie is still cleared alongside it.
    expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(
      true,
    );
  });
});

describe("cleanupImpersonationSessions", () => {
  test("deletes only impersonation sessions older than an hour", async () => {
    const old = new Date(Date.now() - HOUR - 1000);
    const stale = await seedSession("staff", { impersonatedBy: "admin", createdAt: old });
    const fresh = await seedSession("staff", { impersonatedBy: "admin" });
    const own = await seedSession("staff", {
      createdAt: old,
      expiresAt: new Date(Date.now() + DAY),
    });
    await cleanupImpersonationSessions(t.db);
    const left = (await t.db.select({ token: session.token }).from(session)).map((r) => r.token);
    expect(left.sort()).toEqual([fresh.token, own.token].sort());
    expect(left).not.toContain(stale.token);
  });
});
