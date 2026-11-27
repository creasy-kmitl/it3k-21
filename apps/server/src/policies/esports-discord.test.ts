import { describe, expect, test } from "bun:test";
import { user } from "@it3k/db/schema/auth";
import { sportRegistration } from "@it3k/db/schema/sport";
import { eq } from "drizzle-orm";

import { createTestContext } from "../testing";
import { esportsDiscordAudience } from "./esports-discord";

describe("esportsDiscordAudience", () => {
  test("loads the same audience as the /me card, straight from the DB", async () => {
    const t = createTestContext();
    await t.seedUser("tech", { department: "Tech/Live" });
    await t.seedUser("art", { department: "Art" });
    await t.seedParticipant("p1");
    await t.db.insert(sportRegistration).values({
      userId: "p1",
      divisionId: await t.divisionId("esports-tft"),
      institution: "kmutt",
      status: "review",
    });

    expect(await esportsDiscordAudience(t.db, "tech")).toEqual({ staff: true, athlete: false });
    expect(await esportsDiscordAudience(t.db, "art")).toEqual({ staff: false, athlete: false });
    expect(await esportsDiscordAudience(t.db, "p1")).toEqual({ staff: false, athlete: true });
    expect(await esportsDiscordAudience(t.db, "nobody")).toEqual({ staff: false, athlete: false });
  });

  test("a banned account is in no audience", async () => {
    const t = createTestContext();
    await t.seedUser("tech", { department: "Tech/Live" });
    await t.db.update(user).set({ banned: true }).where(eq(user.id, "tech"));
    expect(await esportsDiscordAudience(t.db, "tech")).toEqual({ staff: false, athlete: false });
  });
});
