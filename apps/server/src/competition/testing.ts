// Test helpers for competition routes: seed teams and matches straight into the
// tables, so a stream's tests do not wait on another stream's API.
import {
  competitionMatch,
  competitionMatchParticipant,
  competitionTeam,
  sportDivision,
} from "@it3k/db/schema/index";
import { eq } from "drizzle-orm";

import { type createTestContext, defined } from "../testing";

/** A football match between KMITL and KMUTT, seeded straight into the tables. */
export async function seedMatch(t: ReturnType<typeof createTestContext>, code = "football") {
  const [division] = await t.db
    .select({ id: sportDivision.id })
    .from(sportDivision)
    .where(eq(sportDivision.code, code));
  const divisionId = defined(division).id;
  const [home, away] = await t.db
    .insert(competitionTeam)
    .values([
      { divisionId, institution: "kmitl" },
      { divisionId, institution: "kmutt" },
    ])
    .returning();
  const [match] = await t.db
    .insert(competitionMatch)
    .values({ divisionId, stageName: "รอบแบ่งกลุ่ม" })
    .returning();
  const sides = await t.db
    .insert(competitionMatchParticipant)
    .values([
      { matchId: defined(match).id, teamId: defined(home).id, slot: 1 },
      { matchId: defined(match).id, teamId: defined(away).id, slot: 2 },
    ])
    .returning();
  return { divisionId, match: defined(match), sides };
}
