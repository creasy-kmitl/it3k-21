import { describe, expect, test } from "bun:test";

import {
  divisionCompetitionInput,
  matchInput,
  scoreEventInputSchema,
  scoringConfigSchema,
  standingsConfigSchema,
} from "./competition-rules";
import { sportDivision } from "./schema/index";
import { DIVISION_PRESETS, presetFor, resolveScoringConfig } from "./scoring/presets";
import { createTestDb } from "./testing";

describe("division presets", () => {
  test("every preset's settings pass the schemas the API uses", () => {
    for (const preset of Object.values(DIVISION_PRESETS)) {
      expect(scoringConfigSchema.parse(preset.scoringConfig)).toEqual(preset.scoringConfig);
      if (preset.standingsConfig) {
        expect(standingsConfigSchema.parse(preset.standingsConfig)).toEqual(preset.standingsConfig);
      }
    }
  });

  test("the seed migration gave every seeded division its preset", async () => {
    const { db } = createTestDb();
    const divisions = await db.select().from(sportDivision);
    expect(divisions.map((d) => d.code).toSorted()).toEqual(
      Object.keys(DIVISION_PRESETS).toSorted(),
    );
    for (const division of divisions) {
      const preset = DIVISION_PRESETS[division.code];
      expect(preset).toBeDefined();
      expect({
        maxTeamsPerInstitution: division.maxTeamsPerInstitution,
        teamMinSize: division.teamMinSize,
        teamMaxSize: division.teamMaxSize,
        genderMinimums: division.genderMinimums,
        maxOfficials: division.maxOfficials,
        lineupStarters: division.lineupStarters,
        lineupMaxSubs: division.lineupMaxSubs,
        scoringConfig: division.scoringConfig,
        standingsConfig: division.standingsConfig,
        checkinMode: division.checkinMode,
      }).toEqual(preset as NonNullable<typeof preset>);
      expect(division.checkinOpensMin).toBe(40);
      expect(division.checkinClosesMin).toBe(10);
      expect(division.competitionVersion).toBe(1);
    }
  });

  test("the rules' numbers that matter most", () => {
    expect(DIVISION_PRESETS["badminton-singles-male"]?.maxTeamsPerInstitution).toBe(2);
    expect(DIVISION_PRESETS["badminton-singles-male"]?.scoringConfig).toMatchObject({
      engine: "sets",
      pointsPerSet: 15,
      winBy: 2,
      cap: 21,
    });
    expect(DIVISION_PRESETS["folk-tug-of-war"]?.genderMinimums).toEqual({ male: 2, female: 2 });
    expect(DIVISION_PRESETS["esports-rov"]?.checkinMode).toBe("manual");
    expect(DIVISION_PRESETS.football?.standingsConfig).toMatchObject({ win: 3, draw: 1, loss: 0 });
  });

  test("a division added later gets settings from its format", () => {
    expect(presetFor({ code: "new-relay", format: "individual" }).engine).toBe("race");
    expect(presetFor({ code: "new-team", format: "team" }).engine).toBe("points");
  });

  test("a match's own settings win over its division's", () => {
    const division = {
      code: "basketball-3x3-female",
      format: "team" as const,
      scoringConfig: null,
    };
    const final = { ...presetFor(division), targetScore: 21, targetWinBy: 2 };
    expect(resolveScoringConfig({ scoringConfig: null }, division)).toEqual(presetFor(division));
    expect(resolveScoringConfig({ scoringConfig: final }, division)).toEqual(final);
  });
});

describe("inputs", () => {
  const settings = {
    maxTeamsPerInstitution: 1,
    teamMinSize: 5,
    teamMaxSize: 12,
    genderMinimums: null,
    maxOfficials: 2,
    lineupStarters: 5,
    lineupMaxSubs: 7,
    scoringConfig: null,
    standingsConfig: null,
    checkinMode: "kiosk" as const,
    checkinOpensMin: 40,
    checkinClosesMin: 10,
    checkinMinPlayers: null,
    awardsMedals: true,
    version: 1,
  };

  test("division settings refuse a minimum above the maximum and check-in closing first", () => {
    expect(divisionCompetitionInput.safeParse(settings).success).toBe(true);
    expect(divisionCompetitionInput.safeParse({ ...settings, teamMinSize: 13 }).success).toBe(
      false,
    );
    expect(divisionCompetitionInput.safeParse({ ...settings, checkinClosesMin: 40 }).success).toBe(
      false,
    );
  });

  test("a match side is a team or a named placeholder", () => {
    const base = {
      divisionId: "d",
      parentMatchId: null,
      groupId: null,
      stageName: "รอบแรก",
      roundNo: null,
      matchNo: null,
      startAt: null,
      venueId: null,
      court: null,
      friendly: false,
      scoringConfig: null,
      notes: null,
    };
    expect(
      matchInput.safeParse({ ...base, participants: [{ teamId: "t", label: null }] }).success,
    ).toBe(true);
    expect(
      matchInput.safeParse({ ...base, participants: [{ teamId: null, label: "ผู้ชนะ M3" }] }).success,
    ).toBe(true);
    expect(
      matchInput.safeParse({ ...base, participants: [{ teamId: null, label: " " }] }).success,
    ).toBe(false);
  });

  test("score events need a uuid made by the scorer and a known type", () => {
    const event = {
      id: crypto.randomUUID(),
      clientAt: Date.now(),
      payload: { type: "score", participantId: "p", points: 3, registrationId: null },
    };
    expect(scoreEventInputSchema.safeParse(event).success).toBe(true);
    expect(scoreEventInputSchema.safeParse({ ...event, id: "not-a-uuid" }).success).toBe(false);
    expect(
      scoreEventInputSchema.safeParse({ ...event, payload: { type: "teleport" } }).success,
    ).toBe(false);
  });
});
