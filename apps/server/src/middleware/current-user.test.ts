import { beforeEach, describe, expect, test } from "bun:test";
import { user } from "@it3k/db/schema/index";
import { eq, sql } from "drizzle-orm";

import { createTestContext } from "../testing";
import { abortUnless, constraintError } from "./current-user";

let t: ReturnType<typeof createTestContext>;

beforeEach(async () => {
  t = createTestContext();
  await t.seedUser("actor", { role: "staff,admin", name: "Actor" });
});

async function run(userId: string, stillTrue = sql`1`) {
  try {
    await t.db.batch([
      abortUnless(t.db, userId, stillTrue),
      t.db.update(user).set({ name: "Written" }).where(eq(user.id, "actor")),
    ]);
    return "committed";
  } catch (error) {
    return constraintError(error);
  }
}

describe("abortUnless", () => {
  test("lets the batch through, changing nothing, while the actor still qualifies", async () => {
    const [before] = await t.db.select().from(user).where(eq(user.id, "actor"));
    expect(await run("actor")).toBe("committed");
    const rows = await t.db.select().from(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: "staff,admin",
      name: "Written",
      updatedAt: before?.updatedAt,
    });
  });

  test("rolls the batch back as stale when the check no longer holds", async () => {
    expect(await run("actor", sql`0`)).toBe("stale");
    const [row] = await t.db.select().from(user).where(eq(user.id, "actor"));
    expect(row).toMatchObject({ role: "staff,admin", name: "Actor" });
  });

  test("rolls the batch back as stale when the actor's account is gone", async () => {
    expect(await run("deleted-account")).toBe("stale");
    const rows = await t.db.select().from(user);
    // Nothing written, and no stand-in account left behind.
    expect(rows.map((row) => [row.id, row.name])).toEqual([["actor", "Actor"]]);
  });
});
