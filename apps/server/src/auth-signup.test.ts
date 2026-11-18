import { beforeEach, describe, expect, test } from "bun:test";
import { department, invitation, leadership, user } from "@it3k/db/schema/index";
import { createTestDb } from "@it3k/db/testing";
import { eq } from "drizzle-orm";

import { INVITE_REQUIRED, acceptOnSignup, invitedDefaults, refuseSignup } from "@it3k/auth/signup";

let t: ReturnType<typeof createTestDb>;
const DAY = 24 * 60 * 60 * 1000;

async function departmentId(name: string) {
  const [row] = await t.db
    .select({ id: department.id })
    .from(department)
    .where(eq(department.name, name));
  if (!row) throw new Error(`No department ${name}`);
  return row.id;
}

async function invite(values: Partial<typeof invitation.$inferInsert> & { email: string }) {
  const [row] = await t.db
    .insert(invitation)
    .values({ kind: "guest", expiresAt: new Date(Date.now() + DAY), ...values })
    .returning();
  if (!row) throw new Error("invite not inserted");
  return row;
}

async function createAccount(
  id: string,
  email: string,
  role = "guest",
  departmentId: string | null = null,
) {
  await t.db.insert(user).values({ id, name: `Name ${id}`, email, role, departmentId });
  return { id, name: `Name ${id}`, email };
}

beforeEach(() => {
  t = createTestDb();
});

describe("refuseSignup", () => {
  test("institution addresses sign up on their own", async () => {
    for (const email of [
      "a@kmitl.ac.th",
      "b@kmutt.ac.th",
      "c@kmutnb.ac.th",
      "d@email.kmutnb.ac.th",
      "E@KMITL.AC.TH",
    ]) {
      expect(await refuseSignup(t.db, { email, emailVerified: true })).toBeNull();
    }
  });

  test("other addresses need an invitation", async () => {
    for (const email of ["x@gmail.com", "x@kmitl.ac.th.evil.com", "x@notkmitl.ac.th"]) {
      expect((await refuseSignup(t.db, { email, emailVerified: true }))?.error).toBe(
        INVITE_REQUIRED,
      );
    }
  });

  test("an unverified institution address needs an invitation too", async () => {
    const refused = await refuseSignup(t.db, { email: "a@kmitl.ac.th", emailVerified: false });
    expect(refused?.error).toBe(INVITE_REQUIRED);
  });

  test("an open invitation lets the address in, whatever its case", async () => {
    await invite({ email: "friend@gmail.com" });
    expect(await refuseSignup(t.db, { email: "Friend@Gmail.com", emailVerified: true })).toBeNull();
  });

  test("expired, revoked and accepted invitations do not", async () => {
    await invite({ email: "old@gmail.com", expiresAt: new Date(Date.now() - 1) });
    await invite({ email: "gone@gmail.com", revokedAt: new Date() });
    await invite({ email: "used@gmail.com", acceptedAt: new Date() });
    for (const email of ["old@gmail.com", "gone@gmail.com", "used@gmail.com"]) {
      expect((await refuseSignup(t.db, { email, emailVerified: true }))?.error).toBe(
        INVITE_REQUIRED,
      );
    }
  });
});

describe("invited accounts", () => {
  test("start with the invited institution, when the invitation names one", async () => {
    await invite({ email: "p@gmail.com", kind: "participant", institution: "kmutnb-bangkok" });
    expect(await invitedDefaults(t.db, "p@gmail.com")).toEqual({
      role: "participant",
      departmentId: null,
      institution: "kmutnb-bangkok",
    });
  });

  test("start with the invited role and department", async () => {
    const art = await departmentId("Art");
    await invite({ email: "s@gmail.com", kind: "staff", departmentId: art });
    await invite({ email: "a@kmitl.ac.th", kind: "athlete" });
    expect(await invitedDefaults(t.db, "s@gmail.com")).toEqual({
      role: "staff",
      departmentId: art,
    });
    expect(await invitedDefaults(t.db, "a@kmitl.ac.th")).toEqual({
      role: "athlete",
      departmentId: null,
    });
    expect(await invitedDefaults(t.db, "nobody@kmitl.ac.th")).toBeNull();
  });

  test("accepting marks the invitation and takes a vacant seat", async () => {
    const pr = await departmentId("PR");
    const sent = await invite({ email: "h@gmail.com", kind: "head", departmentId: pr });
    const account = await createAccount("h", "h@gmail.com", "staff", pr);
    expect(await acceptOnSignup(t.db, account)).toMatchObject({ kind: "head", seat: true });
    const [row] = await t.db.select().from(invitation).where(eq(invitation.id, sent.id));
    expect(row?.acceptedUserId).toBe("h");
    expect(row?.acceptedAt).toBeInstanceOf(Date);
    const [seat] = await t.db.select().from(leadership).where(eq(leadership.userId, "h"));
    expect(seat).toMatchObject({ departmentId: pr, role: "head", name: "Name h" });
    // Used up: the same address cannot sign up again with it.
    expect(await invitedDefaults(t.db, "h@gmail.com")).toBeNull();
  });

  test("a seat taken meanwhile leaves the account as staff", async () => {
    const pr = await departmentId("PR");
    await createAccount("holder", "holder@kmitl.ac.th", "staff", pr);
    await t.db
      .insert(leadership)
      .values({ departmentId: pr, role: "head", userId: "holder", name: "Holder" });
    await invite({ email: "late@gmail.com", kind: "head", departmentId: pr });
    const account = await createAccount("late", "late@gmail.com", "staff", pr);
    expect(await acceptOnSignup(t.db, account)).toMatchObject({ seat: false });
    const [seat] = await t.db.select().from(leadership).where(eq(leadership.departmentId, pr));
    expect(seat?.userId).toBe("holder");
  });

  test("one open invitation per address", async () => {
    await invite({ email: "dup@gmail.com" });
    await expect(invite({ email: "dup@gmail.com" })).rejects.toThrow();
    await t.db
      .update(invitation)
      .set({ revokedAt: new Date() })
      .where(eq(invitation.email, "dup@gmail.com"));
    await invite({ email: "dup@gmail.com" });
  });

  test("staff and seats need a department; other kinds must not have one", async () => {
    const art = await departmentId("Art");
    await expect(invite({ email: "a@gmail.com", kind: "staff" })).rejects.toThrow();
    await expect(
      invite({ email: "b@gmail.com", kind: "guest", departmentId: art }),
    ).rejects.toThrow();
  });
});
