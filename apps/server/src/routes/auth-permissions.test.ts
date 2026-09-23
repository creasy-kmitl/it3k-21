import { beforeEach, describe, expect, test } from "bun:test";
import { createAuth } from "@it3k/auth";

import { createTestContext } from "../testing";

let t: ReturnType<typeof createTestContext>;
let auth: ReturnType<typeof createAuth>;

beforeEach(async () => {
  t = createTestContext();
  auth = createAuth(
    {
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      CORS_ORIGIN: "http://localhost:3001",
      GOOGLE_CLIENT_ID: "test",
      GOOGLE_SECRET_ID: "test",
      AUTH_PROXY_URL: "http://localhost:3000",
      OAUTH_PROXY_SECRET: "test-proxy-secret",
    },
    t.db,
  );
  for (const role of ["staff", "head", "vicehead", "admin"]) {
    await t.seedUser(role, { role, department: "Tech/Live" });
  }
});

// Better Auth's /admin/list-users and /admin/get-user run this same check.
async function can(userId: string, permission: "list" | "get") {
  const result = await auth.api.userHasPermission({
    body: { userId, permissions: { user: [permission] } },
  });
  return result.success;
}

describe("Better Auth user directory", () => {
  test("only admins may list or read accounts (emails included)", async () => {
    expect(await can("admin", "list")).toBe(true);
    expect(await can("admin", "get")).toBe(true);
    for (const role of ["staff", "head", "vicehead"]) {
      expect(await can(role, "list")).toBe(false);
      expect(await can(role, "get")).toBe(false);
    }
  });
});
