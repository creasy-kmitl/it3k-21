// Test-only helpers: an in-memory database plus a header-based stand-in for
// the Better Auth session so routes can be exercised with Hono#request.
import { department, user } from "@it3k/db/schema/index";
import { createTestDb } from "@it3k/db/testing";
import { eq } from "drizzle-orm";

import type { RouteDeps } from "./routes/current-user";

const TEST_USER_HEADER = "x-test-user";
const TEST_IMPERSONATOR_HEADER = "x-test-impersonated-by";

export function createTestContext() {
  const { db, sqlite, hooks } = createTestDb();

  const deps: RouteDeps = {
    getSession: async (headers) => {
      const userId = headers.get(TEST_USER_HEADER);
      if (!userId) return null;
      return { userId, impersonatedBy: headers.get(TEST_IMPERSONATOR_HEADER) };
    },
    getDb: () => db,
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
    options: { role?: string; department?: string; banned?: boolean; name?: string } = {},
  ) {
    await db.insert(user).values({
      id,
      name: options.name ?? `User ${id}`,
      email: `${id}@example.com`,
      role: options.role ?? "staff",
      banned: options.banned ?? false,
      departmentId: options.department ? await departmentId(options.department) : null,
    });
    return id;
  }

  /** Request init for a signed-in user, with an optional JSON body. */
  function as(userId: string | null, init: { method?: string; json?: unknown } = {}): RequestInit {
    const headers = new Headers();
    if (userId) headers.set(TEST_USER_HEADER, userId);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    return {
      method: init.method ?? "GET",
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    };
  }

  return { db, sqlite, hooks, deps, departmentId, seedUser, as };
}

/** Parsed JSON body, typed loosely enough for `toEqual` assertions. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
