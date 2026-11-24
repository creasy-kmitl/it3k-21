// Starting settings for each seeded division, read from the IT3K 21 rule
// announcements (packages/db/sport-rules). The seed_competition_config
// migration copied them into sport_division; staff change them from there.
// presetFor() also covers divisions added later, from their format alone.
import type { CheckinMode, GenderMinimums, StandingsConfig } from "../competition-rules";
import type { DivisionFormat } from "../sport-rules";
import type { ScoringConfig } from "./config";

export type DivisionPreset = {
  maxTeamsPerInstitution: number;
  teamMinSize: number | null;
  teamMaxSize: number | null;
  genderMinimums: GenderMinimums | null;
  maxOfficials: number;
  lineupStarters: number | null;
  lineupMaxSubs: number | null;
  scoringConfig: ScoringConfig;
  standingsConfig: StandingsConfig | null;
  checkinMode: CheckinMode;
};

const groupPoints = (win: number, draw: number, loss: number): StandingsConfig => ({
  win,
  draw,
  loss,
  forfeit: 0,
  tiebreaks: ["headToHead", "scoreDiff", "scoreFor"],
});

const football: ScoringConfig = {
  engine: "points",
  buttons: [1],
  periods: { count: 2, label: "ครึ่ง" },
  overtime: null,
  targetScore: null,
  targetWinBy: null,
  allowDraw: true,
  shootout: { label: "ดวลจุดโทษ", kicks: 5 },
  clock: null,
};

const basketball5x5: ScoringConfig = {
  engine: "points",
  buttons: [1, 2, 3],
  periods: { count: 4, label: "ควอเตอร์" },
  overtime: { label: "ต่อเวลา" },
  targetScore: null,
  targetWinBy: null,
  allowDraw: false,
  shootout: null,
  clock: null,
};

// Group games end at 15 (or on time); the final round is set to 21, by 2.
const basketball3x3: ScoringConfig = {
  engine: "points",
  buttons: [1, 2],
  periods: { count: 1, label: "เกม" },
  overtime: { label: "ต่อเวลา" },
  targetScore: 15,
  targetWinBy: null,
  allowDraw: false,
  shootout: null,
  clock: null,
};

const chairball: ScoringConfig = {
  engine: "points",
  buttons: [1, 2],
  periods: { count: 2, label: "ครึ่ง" },
  overtime: { label: "ต่อเวลา" },
  targetScore: null,
  targetWinBy: null,
  allowDraw: false,
  shootout: { label: "ยิงโทษ", kicks: 5 },
  clock: null,
};

const badminton: ScoringConfig = {
  engine: "sets",
  pointsPerSet: 15,
  winBy: 2,
  cap: 21,
  setsToWin: 2,
  intervalAt: 8,
  setLabel: "เกม",
};

const tableTennis: ScoringConfig = {
  engine: "sets",
  pointsPerSet: 11,
  winBy: 2,
  cap: null,
  setsToWin: 3,
  intervalAt: null,
  setLabel: "เกม",
};

const petanque: ScoringConfig = { engine: "ends", maxPerEnd: 6, targetScore: 13 };

const sprint: ScoringConfig = {
  engine: "race",
  measure: "time",
  lowerIsBetter: true,
  placementPoints: null,
  games: 1,
  decideBy: "total",
};

const bestOf3 = (gameLabel: string): ScoringConfig => ({
  engine: "series",
  gamesToWin: 2,
  gameLabel,
  fromSubMatches: false,
});

// Group games are one game; later rounds are set per match.
const singleGame = (gameLabel: string): ScoringConfig => ({
  engine: "series",
  gamesToWin: 1,
  gameLabel,
  fromSubMatches: false,
});

const valorant: ScoringConfig = {
  engine: "sets",
  pointsPerSet: 13,
  winBy: 2,
  cap: null,
  setsToWin: 1,
  intervalAt: null,
  setLabel: "แผนที่",
};

const tft: ScoringConfig = {
  engine: "race",
  measure: "placement",
  lowerIsBetter: false,
  placementPoints: [8, 7, 6, 5, 4, 3, 2, 1],
  games: 1,
  decideBy: "gameWins",
};

type PresetBase = Omit<DivisionPreset, "checkinMode" | "maxTeamsPerInstitution"> &
  Partial<Pick<DivisionPreset, "checkinMode" | "maxTeamsPerInstitution">>;

const team = (
  min: number,
  max: number,
  starters: number,
  subs: number,
  officials: number,
  scoringConfig: ScoringConfig,
  standingsConfig: StandingsConfig | null,
): PresetBase => ({
  teamMinSize: min,
  teamMaxSize: max,
  genderMinimums: null,
  maxOfficials: officials,
  lineupStarters: starters,
  lineupMaxSubs: subs,
  scoringConfig,
  standingsConfig,
});

const BASES: Record<string, PresetBase> = {
  football: team(11, 25, 11, 14, 2, football, groupPoints(3, 1, 0)),
  "basketball-5x5-male": team(5, 12, 5, 7, 2, basketball5x5, groupPoints(2, 1, 0)),
  "basketball-3x3-female": team(3, 4, 3, 1, 1, basketball3x3, groupPoints(2, 1, 0)),
  "chairball-male": team(7, 15, 7, 8, 2, chairball, groupPoints(2, 1, 0)),
  "chairball-female": team(7, 15, 7, 8, 2, chairball, groupPoints(2, 1, 0)),
  "badminton-singles-male": {
    ...team(1, 2, 1, 0, 1, badminton, null),
    maxTeamsPerInstitution: 2,
  },
  "badminton-singles-female": {
    ...team(1, 2, 1, 0, 1, badminton, null),
    maxTeamsPerInstitution: 2,
  },
  "badminton-doubles-male": team(2, 3, 2, 0, 1, badminton, null),
  "badminton-doubles-female": team(2, 3, 2, 0, 1, badminton, null),
  "badminton-doubles-mixed": team(2, 3, 2, 0, 1, badminton, null),
  "table-tennis-singles-male": team(1, 2, 1, 0, 1, tableTennis, null),
  "table-tennis-singles-female": team(1, 2, 1, 0, 1, tableTennis, null),
  "table-tennis-doubles-male": team(2, 4, 2, 0, 1, tableTennis, null),
  "table-tennis-doubles-female": team(2, 4, 2, 0, 1, tableTennis, null),
  "table-tennis-doubles-mixed": team(2, 4, 2, 0, 1, tableTennis, null),
  "petanque-male": team(2, 4, 2, 0, 1, petanque, null),
  "petanque-female": team(2, 4, 2, 0, 1, petanque, null),
  "petanque-mixed": team(2, 4, 2, 0, 1, petanque, null),
  "athletics-100m-male": team(1, 2, 1, 0, 1, sprint, null),
  "athletics-100m-female": team(1, 2, 1, 0, 1, sprint, null),
  "athletics-400m-male": team(1, 2, 1, 0, 1, sprint, null),
  "athletics-400m-female": team(1, 2, 1, 0, 1, sprint, null),
  "athletics-4x100m-male": team(4, 6, 4, 0, 1, sprint, null),
  "athletics-4x100m-female": team(4, 6, 4, 0, 1, sprint, null),
  // The rules name no team officials for tug-of-war or the obstacle race.
  "folk-tug-of-war": {
    ...team(10, 12, 10, 2, 0, bestOf3("ครั้ง"), null),
    genderMinimums: { male: 2, female: 2 },
  },
  "folk-relay": {
    ...team(10, 12, 10, 2, 5, bestOf3("รอบ"), null),
    genderMinimums: { male: 2, female: 2 },
  },
  "folk-obstacle-eating": team(3, 5, 3, 0, 0, sprint, null),
  "esports-rov": {
    ...team(5, 7, 5, 2, 1, singleGame("เกม"), groupPoints(1, 0, 0)),
    checkinMode: "manual",
  },
  "esports-valorant": {
    ...team(5, 7, 5, 2, 1, valorant, groupPoints(1, 0, 0)),
    checkinMode: "manual",
  },
  "esports-tft": {
    ...team(4, 6, 4, 2, 1, tft, groupPoints(1, 0, 0)),
    checkinMode: "manual",
  },
};

/** The rule-based settings of every seeded division, by division code. */
export const DIVISION_PRESETS: Record<string, DivisionPreset> = Object.fromEntries(
  Object.entries(BASES).map(([code, base]) => [
    code,
    { maxTeamsPerInstitution: 1, checkinMode: "kiosk", ...base },
  ]),
);

const BY_FORMAT: Record<DivisionFormat, ScoringConfig> = {
  individual: sprint,
  pair: badminton,
  team: football,
};

/** A division's scoring settings when staff have not set any. */
export function presetFor(division: { code: string; format: DivisionFormat }): ScoringConfig {
  return DIVISION_PRESETS[division.code]?.scoringConfig ?? BY_FORMAT[division.format];
}

/** The settings a match is scored by: its own for its round, else its division's. */
export function resolveScoringConfig(
  match: { scoringConfig: ScoringConfig | null },
  division: { code: string; format: DivisionFormat; scoringConfig: ScoringConfig | null },
): ScoringConfig {
  return match.scoringConfig ?? division.scoringConfig ?? presetFor(division);
}
