import { beforeEach, describe, expect, test } from "bun:test";
import { session } from "@it3k/db/schema/auth";
import { event, eventCheckin, eventTicket } from "@it3k/db/schema/event";
import { invitation } from "@it3k/db/schema/invitation";
import { leadership, leadershipSocial } from "@it3k/db/schema/leadership";
import { EMPTY_PROFILE } from "@it3k/db/profile";
import { uploadedFile, userProfile } from "@it3k/db/schema/profile";
import { athlete, sportRegistration, sportRegistrationChange } from "@it3k/db/schema/sport";
import { eq } from "drizzle-orm";

import { createTestContext, defined } from "./testing";
import { cleanupExpiredSessions, purgeExpiredPersonalData } from "./retention";

// The event ends 26 Dec 2026, so its season is purged on 26 Dec 2027.
const DATES = ["2026-12-26"];
const LAST_SEASON = new Date("2026-11-20T10:00:00+07:00");
const THIS_SEASON = new Date("2027-11-20T10:00:00+07:00");
const DUE = new Date("2027-12-26T01:00:00+07:00");
const NOT_YET = new Date("2027-12-25T23:00:00+07:00");

let t: ReturnType<typeof createTestContext>;

const later = (date: Date) => new Date(date.getTime() + 3_600_000);

beforeEach(() => {
  t = createTestContext();
});

async function seedProfile(userId: string, updatedAt: Date, photoFileId: string) {
  await t.seedUser(userId, { role: "participant" });
  await t.seedUpload(userId, photoFileId);
  const values = {
    ...EMPTY_PROFILE,
    firstName: "สมชาย",
    phone: "0812345678",
    drugAllergies: "เพนิซิลลิน",
    photoFileId,
  };
  await t.db
    .insert(userProfile)
    .values({ userId, draft: values, values, submittedAt: updatedAt, dirty: false, updatedAt });
}

let shirt = 0;

async function seedRegistration(userId: string, updatedAt: Date, cardId: string) {
  await t.seedUpload(userId, cardId);
  const [row] = await t.db
    .insert(sportRegistration)
    .values({
      userId,
      divisionId: await t.divisionId("athletics-400m-male"),
      institution: "kmutt",
      status: "approved",
      shirtNumber: ++shirt,
      ign: "ShadowFox",
      ignReading: "แชโดว์ฟ็อกซ์",
      facebookUrl: "https://facebook.com/somchai",
      discordUserId: "123",
      discordUsername: "somchai",
      studentCardFileId: cardId,
      reviewNote: "บัตรไม่ชัด",
      createdAt: updatedAt,
      updatedAt,
    })
    .returning();
  return defined(row);
}

async function fileState(id: string) {
  const [row] = await t.db.select().from(uploadedFile).where(eq(uploadedFile.id, id));
  return row?.state;
}

describe("purgeExpiredPersonalData", () => {
  test("does nothing before the purge date or with no event dates", async () => {
    await seedProfile("p1", LAST_SEASON, "photo-1");

    expect(await purgeExpiredPersonalData(t.db, NOT_YET, DATES)).toBeNull();
    expect(await purgeExpiredPersonalData(t.db, DUE, [])).toBeNull();

    expect(await t.db.select().from(userProfile)).toHaveLength(1);
    expect(await fileState("photo-1")).toBe("ready");
  });

  test("deletes last season's profiles and hands their photos to file cleanup", async () => {
    await seedProfile("old", LAST_SEASON, "photo-old");
    await seedProfile("new", THIS_SEASON, "photo-new");

    const cutoff = await purgeExpiredPersonalData(t.db, DUE, DATES);

    expect(cutoff?.toISOString()).toBe("2026-12-26T16:59:59.999Z");
    const left = await t.db.select({ userId: userProfile.userId }).from(userProfile);
    expect(left).toEqual([{ userId: "new" }]);
    expect(await fileState("photo-old")).toBe("deleting");
    expect(await fileState("photo-new")).toBe("ready");
  });

  test("blanks last season's registrations but keeps what results show", async () => {
    await t.seedParticipant("a1");
    const old = await seedRegistration("a1", LAST_SEASON, "card-old");
    await t.seedParticipant("a2");
    const kept = await seedRegistration("a2", THIS_SEASON, "card-new");

    await purgeExpiredPersonalData(t.db, DUE, DATES);

    const [after] = await t.db
      .select()
      .from(sportRegistration)
      .where(eq(sportRegistration.id, old.id));
    expect(after).toMatchObject({
      status: "approved",
      shirtNumber: old.shirtNumber,
      institution: "kmutt",
      ign: "",
      ignReading: "",
      facebookUrl: "",
      discordUserId: null,
      discordUsername: null,
      studentCardFileId: null,
      reviewNote: null,
      version: old.version + 1,
    });
    expect(after?.updatedAt.getTime()).toBe(LAST_SEASON.getTime());
    expect(await fileState("card-old")).toBe("deleting");

    const [untouched] = await t.db
      .select()
      .from(sportRegistration)
      .where(eq(sportRegistration.id, kept.id));
    expect(untouched).toEqual(kept);
    expect(await fileState("card-new")).toBe("ready");
  });

  test("keeps a returning athlete's student id, check-in code and reused card", async () => {
    // Last season's athlete who has not come back.
    await t.seedParticipant("gone");
    await seedRegistration("gone", LAST_SEASON, "card-gone");
    await t.db.insert(athlete).values({
      userId: "gone",
      studentId: "64070001",
      studentCardFileId: "card-gone",
      checkinCode: "111111",
      updatedAt: LAST_SEASON,
    });
    // An athlete from last season who registered again, attaching the same card.
    await t.seedParticipant("back");
    await seedRegistration("back", LAST_SEASON, "card-back");
    const again = await t.db
      .insert(sportRegistration)
      .values({
        userId: "back",
        divisionId: await t.divisionId("football"),
        institution: "kmutt",
        studentCardFileId: "card-back",
        updatedAt: THIS_SEASON,
      })
      .returning();
    await t.db.insert(athlete).values({
      userId: "back",
      studentId: "64070002",
      studentCardFileId: "card-back",
      checkinCode: "222222",
      updatedAt: LAST_SEASON,
    });

    await purgeExpiredPersonalData(t.db, DUE, DATES);

    const rows = await t.db.select().from(athlete);
    expect(rows.find((row) => row.userId === "gone")).toMatchObject({
      studentId: "",
      studentCardFileId: null,
      checkinCode: null,
    });
    expect(rows.find((row) => row.userId === "back")).toMatchObject({
      studentId: "64070002",
      studentCardFileId: "card-back",
      checkinCode: "222222",
    });
    expect(await fileState("card-gone")).toBe("deleting");
    // Last season's registration no longer names it, but this season's does.
    expect(await fileState("card-back")).toBe("ready");
    expect(defined(again[0]).studentCardFileId).toBe("card-back");
  });

  test("clears stale leader contacts but keeps the seat", async () => {
    await t.seedUser("head", { department: "Art", seat: "head" });
    const [seat] = await t.db
      .update(leadership)
      .set({ nickname: "ต้น", phone: "0899999999", updatedAt: LAST_SEASON })
      .where(eq(leadership.userId, "head"))
      .returning();
    await t.db
      .insert(leadershipSocial)
      .values({ leadershipId: defined(seat).id, platform: "line", value: "ton" });

    await purgeExpiredPersonalData(t.db, DUE, DATES);

    const [after] = await t.db.select().from(leadership).where(eq(leadership.userId, "head"));
    expect(after).toMatchObject({ userId: "head", nickname: null, phone: null });
    expect(await t.db.select().from(leadershipSocial)).toEqual([]);
  });

  test("deletes last season's history, invitations, tickets and check-ins", async () => {
    await t.seedParticipant("p1");
    const expiresAt = new Date(LAST_SEASON.getTime() + 14 * 86_400_000);
    await t.db.insert(invitation).values([
      { email: "old@example.com", kind: "guest", createdAt: LAST_SEASON, expiresAt },
      { email: "new@example.com", kind: "guest", createdAt: THIS_SEASON, expiresAt: DUE },
    ]);
    await t.db.insert(sportRegistrationChange).values([
      {
        registrationId: "r1",
        athleteUserId: "p1",
        actorUserId: "p1",
        action: "register",
        changes: {},
        createdAt: LAST_SEASON,
      },
      {
        registrationId: "r2",
        athleteUserId: "p1",
        actorUserId: "p1",
        action: "register",
        changes: {},
        createdAt: THIS_SEASON,
      },
    ]);
    const [past, upcoming] = await t.db
      .insert(event)
      .values([
        { type: "general", name: "เปิดงาน 2026", startAt: LAST_SEASON, endAt: later(LAST_SEASON) },
        { type: "general", name: "เปิดงาน 2027", startAt: THIS_SEASON, endAt: later(THIS_SEASON) },
      ])
      .returning();
    const [oldTicket, newTicket] = await t.db
      .insert(eventTicket)
      .values([
        { eventId: defined(past).id, userId: "p1", code: "OLD-1" },
        { eventId: defined(upcoming).id, userId: "p1", code: "NEW-1" },
      ])
      .returning();
    await t.db.insert(eventCheckin).values([
      { eventId: defined(past).id, userId: "p1", ticketId: defined(oldTicket).id, method: "scan" },
      {
        eventId: defined(upcoming).id,
        userId: "p1",
        ticketId: defined(newTicket).id,
        method: "scan",
      },
    ]);

    await purgeExpiredPersonalData(t.db, DUE, DATES);

    expect((await t.db.select().from(invitation)).map((row) => row.email)).toEqual([
      "new@example.com",
    ]);
    expect(
      (await t.db.select().from(sportRegistrationChange)).map((row) => row.registrationId),
    ).toEqual(["r2"]);
    expect((await t.db.select().from(eventTicket)).map((row) => row.code)).toEqual(["NEW-1"]);
    expect((await t.db.select().from(eventCheckin)).map((row) => row.eventId)).toEqual([
      defined(upcoming).id,
    ]);
  });

  test("a second run changes nothing", async () => {
    await t.seedParticipant("a1");
    const old = await seedRegistration("a1", LAST_SEASON, "card-old");

    await purgeExpiredPersonalData(t.db, DUE, DATES);
    await purgeExpiredPersonalData(t.db, new Date(DUE.getTime() + 3_600_000), DATES);

    const [after] = await t.db
      .select({ version: sportRegistration.version })
      .from(sportRegistration)
      .where(eq(sportRegistration.id, old.id));
    expect(after?.version).toBe(old.version + 1);
  });
});

describe("cleanupExpiredSessions", () => {
  test("deletes only sessions past their expiry", async () => {
    await t.seedUser("u1");
    const now = new Date("2027-01-01T00:00:00Z");
    await t.db.insert(session).values([
      {
        id: "s-old",
        token: "old",
        userId: "u1",
        ipAddress: "203.0.113.1",
        expiresAt: new Date(now.getTime() - 1),
        updatedAt: now,
      },
      {
        id: "s-live",
        token: "live",
        userId: "u1",
        expiresAt: new Date(now.getTime() + 1),
        updatedAt: now,
      },
    ]);

    await cleanupExpiredSessions(t.db, now);

    expect((await t.db.select().from(session)).map((row) => row.id)).toEqual(["s-live"]);
  });
});
