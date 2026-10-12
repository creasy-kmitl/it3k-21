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
  await t.seedUser("guest", { role: "guest" });
  await t.seedUser("staff", { department: "Tech/Live" });
  await t.seedUser("admin", { role: "admin", department: "Tech/Live" });
  // Seat holders get no Better Auth grants of their own.
  await t.seedUser("head", { seat: "head", department: "Tech/Live" });
  await t.seedUser("vicehead", { seat: "vicehead", department: "Tech/Live" });
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
    for (const id of ["guest", "staff", "head", "vicehead"]) {
      expect(await can(id, "list")).toBe(false);
      expect(await can(id, "get")).toBe(false);
    }
  });
});
