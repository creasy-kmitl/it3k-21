import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createTestDb } from "../testing";
import { department, leadership, leadershipSocial, user } from "./index";

let t: ReturnType<typeof createTestDb>;

async function seedDepartment(name: string) {
  const [row] = await t.db.select().from(department).where(eq(department.name, name));
  if (!row) throw new Error(`seed department ${name} missing`);
  return row;
}

async function seedUser(id: string) {
  await t.db.insert(user).values({ id, name: `User ${id}`, email: `${id}@example.com` });
  return id;
}

beforeEach(() => {
  t = createTestDb();
});

describe("department code", () => {
  test("backfills stable codes for the seeded manager departments", async () => {
    const rows = await t.db
      .select({ name: department.name, code: department.code })
      .from(department)
      .orderBy(department.name);
    const coded = rows.filter((row) => row.code !== null);
    expect(coded).toEqual([
      { name: "Tech/Live", code: "tech-live" },
      { name: "ทะเบียน", code: "registration" },
    ]);
  });

  test("codes are unique", async () => {
    const art = await seedDepartment("Art");
    expect(() =>
      t.sqlite.run("UPDATE department SET code = 'tech-live' WHERE id = ?", [art.id]),
    ).toThrow(/UNIQUE/);
  });
});

describe("leadership", () => {
  test("generates a UUID id", async () => {
    const art = await seedDepartment("Art");
    const [row] = await t.db
      .insert(leadership)
      .values({ departmentId: art.id, role: "head", name: "A" })
      .returning();
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row?.userId).toBeNull();
    expect(row?.phone).toBeNull();
  });

  test("allows one head and one vicehead per department", async () => {
    const art = await seedDepartment("Art");
    await t.db.insert(leadership).values([
      { departmentId: art.id, role: "head", name: "A" },
      { departmentId: art.id, role: "vicehead", name: "B" },
    ]);
    await expect(
      t.db.insert(leadership).values({ departmentId: art.id, role: "head", name: "C" }).run(),
    ).rejects.toThrow();
  });

  test("attaches a user to at most one seat, but many seats may be unattached", async () => {
    const art = await seedDepartment("Art");
    const pr = await seedDepartment("PR");
    const userId = await seedUser("u1");
    await t.db.insert(leadership).values([
      { departmentId: art.id, role: "head", name: "A", userId },
      { departmentId: art.id, role: "vicehead", name: "B" },
      { departmentId: pr.id, role: "head", name: "C" },
    ]);
    await expect(
      t.db.insert(leadership).values({ departmentId: pr.id, role: "vicehead", name: "D", userId }).run(),
    ).rejects.toThrow();
  });

  test("rejects roles outside head/vicehead at the database", async () => {
    const art = await seedDepartment("Art");
    expect(() =>
      t.sqlite.run(
        "INSERT INTO leadership (id, department_id, role, name) VALUES ('x', ?, 'staff', 'X')",
        [art.id],
      ),
    ).toThrow(/CHECK/);
  });

  test("detaches the seat when its user is deleted", async () => {
    const art = await seedDepartment("Art");
    const userId = await seedUser("u1");
    const [row] = await t.db
      .insert(leadership)
      .values({ departmentId: art.id, role: "head", name: "A", userId })
      .returning();
    await t.db.delete(user).where(eq(user.id, userId));
    const [after] = await t.db.select().from(leadership).where(eq(leadership.id, row!.id));
    expect(after?.userId).toBeNull();
  });

  test("cascades socials when a seat is deleted", async () => {
    const art = await seedDepartment("Art");
    const [row] = await t.db
      .insert(leadership)
      .values({ departmentId: art.id, role: "head", name: "A" })
      .returning();
    await t.db.insert(leadershipSocial).values([
      { leadershipId: row!.id, platform: "line", value: "a.line" },
      { leadershipId: row!.id, platform: "instagram", value: "a.ig" },
    ]);
    await t.db.delete(leadership).where(eq(leadership.id, row!.id));
    expect(await t.db.select().from(leadershipSocial)).toEqual([]);
  });

  test("refuses to delete a department that still has seats", async () => {
    const art = await seedDepartment("Art");
    await t.db.insert(leadership).values({ departmentId: art.id, role: "head", name: "A" });
    await expect(t.db.delete(department).where(eq(department.id, art.id)).run()).rejects.toThrow();
  });
});
