import { beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { EMPTY_PROFILE } from "@it3k/db/profile";
import { userProfile } from "@it3k/db/schema/profile";
import { createTestContext, defined } from "../../testing";
import { createProfileRoutes } from ".";
import { MAX_JSON_BODY_SIZE } from "../../middleware/json-body-limit";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof setup>;
function setup() {
  return new Hono().route("/api/profile", createProfileRoutes(t.deps));
}
beforeEach(async () => {
  t = createTestContext();
  await t.seedUser("guest", { role: "guest" });
  app = setup();
});
async function save(firstName: string, revision = 0) {
  return app.request(
    "/api/profile/draft",
    t.as("guest", {
      method: "PUT",
      json: {
        userId: "guest",
        revision,
        values: { ...EMPTY_PROFILE, firstName },
      },
    }),
  );
}
test("replaying the exact last draft acknowledges it without another write", async () => {
  expect((await save("A")).status).toBe(200);
  const original = defined((await t.db.select().from(userProfile))[0]);
  const replay = await save("A");
  expect(replay.status).toBe(200);
  expect((await replay.json()) as unknown).toEqual({ revision: 1 });
  expect(defined((await t.db.select().from(userProfile))[0])).toEqual(original);
  expect((await save("B")).status).toBe(409);
});
test("padded draft requests are rejected before JSON validation and any writes", async () => {
  const headers = new Headers(t.as("guest").headers);
  headers.set("content-type", "application/json");
  const body =
    " ".repeat(MAX_JSON_BODY_SIZE) +
    JSON.stringify({ userId: "guest", revision: 0, values: EMPTY_PROFILE });
  expect((await app.request("/api/profile/draft", { method: "PUT", headers, body })).status).toBe(
    413,
  );
  expect(await t.db.select().from(userProfile)).toEqual([]);
});
test("the byte limit still accepts all draft fields at their documented maximum", async () => {
  const values = {
    ...EMPTY_PROFILE,
    firstName: "\0".repeat(100),
    lastName: "\0".repeat(100),
    nickname: "\0".repeat(100),
    phone: "\0".repeat(32),
    medicalConditions: "\0".repeat(2000),
    drugAllergies: "\0".repeat(2000),
    foodAllergies: "\0".repeat(2000),
    dietaryRestrictions: "\0".repeat(2000),
  };
  // Escaping every code unit is larger than sending literal Thai text.
  const body = JSON.stringify({ userId: "guest", revision: 0, values });
  expect(new TextEncoder().encode(body).byteLength).toBeLessThan(MAX_JSON_BODY_SIZE);
  const headers = new Headers(t.as("guest").headers);
  headers.set("content-type", "application/json");
  expect((await app.request("/api/profile/draft", { method: "PUT", headers, body })).status).toBe(
    200,
  );
});
test("a later edit or submission is never mistaken for a replay", async () => {
  expect((await save("A")).status).toBe(200);
  expect((await save("B", 1)).status).toBe(200);
  expect((await save("A")).status).toBe(409);
  await t.db.update(userProfile).set({ dirty: false }).where(eq(userProfile.userId, "guest"));
  expect((await save("B", 1)).status).toBe(409);
});
test("a replay is rechecked atomically against a competing edit", async () => {
  expect((await save("A")).status).toBe(200);
  t.hooks.beforeBatch = () => {
    t.hooks.beforeBatch = undefined;
    t.sqlite.run("update user_profile set revision = 2, draft = ? where user_id = 'guest'", [
      JSON.stringify({ ...EMPTY_PROFILE, firstName: "B" }),
    ]);
  };
  expect((await save("A")).status).toBe(409);
  expect(defined((await t.db.select().from(userProfile))[0]).draft.firstName).toBe("B");
});
