// Test-only helpers: an in-memory database plus a header-based stand-in for
// the Better Auth session so routes can be exercised with Hono#request.
import {
  type LeadershipRole,
  department,
  leadership,
  sportDivision,
  user,
  userProfile,
} from "@it3k/db/schema/index";
import { EMPTY_PROFILE, type Institution } from "@it3k/db/profile";
import { createTestDb } from "@it3k/db/testing";

export { defined } from "@it3k/db/testing";
import { eq } from "drizzle-orm";

import type { EmailJob } from "@it3k/email/jobs";
import type { Mailer } from "./email/mailer";
import type { RouteDeps } from "./middleware/current-user";

/** Collects what routes queue instead of sending; set `failing` to make enqueue throw. */
export function createFakeMailer() {
  const jobs: EmailJob[] = [];
  const mailer: Mailer & { jobs: EmailJob[]; failing: boolean } = {
    jobs,
    failing: false,
    async enqueue(batch) {
      if (mailer.failing) throw new Error("queue unavailable");
      jobs.push(...batch);
    },
  };
  return mailer;
}

const TEST_USER_HEADER = "x-test-user";
const TEST_IMPERSONATOR_HEADER = "x-test-impersonated-by";
const TEST_SESSION_CREATED_HEADER = "x-test-session-created-at";
export const TEST_VIEW_AS_SECRET = "test-view-as-secret";

export function createTestContext() {
  const { db, sqlite, hooks } = createTestDb();
  const mail = createFakeMailer();

  const deps: RouteDeps & { mailer: Mailer } = {
    getSession: async (headers) => {
      const userId = headers.get(TEST_USER_HEADER);
      if (!userId) return null;
      const createdAt = headers.get(TEST_SESSION_CREATED_HEADER);
      return {
        userId,
        impersonatedBy: headers.get(TEST_IMPERSONATOR_HEADER),
        createdAt: createdAt ? new Date(Number(createdAt)) : new Date(),
      };
    },
    getDb: () => db,
    viewAsSecret: TEST_VIEW_AS_SECRET,
    mailer: mail,
  };

  async function departmentId(name: string) {
    const [row] = await db
      .select({ id: department.id })
      .from(department)
      .where(eq(department.name, name));
    if (!row) throw new Error(`No seeded department named ${name}`);
    return row.id;
  }

  async function seedUser(
    id: string,
    options: {
      role?: string;
      department?: string;
      /** Attaches the account to this seat in its department. */
      seat?: LeadershipRole;
      banned?: boolean;
      name?: string;
      institution?: Institution;
    } = {},
  ) {
    const deptId = options.department ? await departmentId(options.department) : null;
    await db.insert(user).values({
      id,
      name: options.name ?? `User ${id}`,
      email: `${id}@example.com`,
      role: options.role ?? "staff",
      banned: options.banned ?? false,
      departmentId: deptId,
      institution: options.institution ?? null,
    });
    if (options.seat) {
      if (!deptId) throw new Error(`A seat needs a department (${id})`);
      await db.insert(leadership).values({
        departmentId: deptId,
        role: options.seat,
        userId: id,
        name: options.name ?? `User ${id}`,
      });
    }
    return id;
  }

  /** A participant who submitted a profile naming `institution`. */
  async function seedParticipant(id: string, institution: Institution | "" = "kmutt") {
    await seedUser(id, { role: "participant", name: `Athlete ${id}` });
    await db.insert(userProfile).values({
      userId: id,
      draft: EMPTY_PROFILE,
      values: { ...EMPTY_PROFILE, firstName: "สมชาย", lastName: id, phone: "0812345678", institution },
      submittedAt: new Date(),
      dirty: false,
    });
    return id;
  }

  /** The id of a seeded sport division, by code. */
  async function divisionId(code: string) {
    const [row] = await db
      .select({ id: sportDivision.id })
      .from(sportDivision)
      .where(eq(sportDivision.code, code));
    if (!row) throw new Error(`No seeded division with code ${code}`);
    return row.id;
  }

  /**
   * Request init for a signed-in user, with an optional JSON body. `impersonatedBy`
   * makes it an admin's impersonation session, begun `sessionCreatedAt`.
   */
  function as(
    userId: string | null,
    init: {
      method?: string;
      json?: unknown;
      cookie?: string;
      impersonatedBy?: string;
      sessionCreatedAt?: Date;
    } = {},
  ): RequestInit {
    const headers = new Headers();
    if (userId) headers.set(TEST_USER_HEADER, userId);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.impersonatedBy) headers.set(TEST_IMPERSONATOR_HEADER, init.impersonatedBy);
    if (init.sessionCreatedAt) {
      headers.set(TEST_SESSION_CREATED_HEADER, String(init.sessionCreatedAt.getTime()));
    }
    if (init.json !== undefined) headers.set("content-type", "application/json");
    return {
      method: init.method ?? "GET",
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    };
  }

  return { db, sqlite, hooks, deps, mail, departmentId, seedUser, seedParticipant, divisionId, as };
}

/** Parsed JSON body, typed loosely enough for `toEqual` assertions. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
