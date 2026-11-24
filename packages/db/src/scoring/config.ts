// How a division's matches are scored. Each division picks one of five engines
// and its settings; a match may override them for its round (finals often run
// longer). Kept free of Drizzle so the web app can use it.
import { z } from "zod";

export const SCORING_ENGINES = ["points", "sets", "series", "ends", "race"] as const;
export type ScoringEngine = (typeof SCORING_ENGINES)[number];

export const ENGINE_LABELS: Record<ScoringEngine, string> = {
  points: "นับแต้มสะสม",
  sets: "แข่งเป็นเซต",
  series: "นับเกมที่ชนะ",
  ends: "นับแต้มรายเอนด์",
  race: "จัดอันดับ",
};

const label = z.string().trim().min(1).max(40);
const count = (max: number) => z.number().int().min(1).max(max);

/** An optional game clock. Off unless set; the scorer can always run without it. */
export const clockConfigSchema = z.strictObject({
  periodSeconds: z
    .number()
    .int()
    .min(30)
    .max(120 * 60),
  overtimeSeconds: z
    .number()
    .int()
    .min(30)
    .max(60 * 60)
    .nullable(),
});
export type ClockConfig = z.infer<typeof clockConfigSchema>;

/** Goals, baskets and the like, added up over periods (football, basketball, chairball). */
export const pointsConfigSchema = z.strictObject({
  engine: z.literal("points"),
  // The buttons the scorer gets, e.g. [1, 2, 3] for basketball.
  buttons: z.array(count(10)).min(1).max(6),
  periods: z.strictObject({ count: count(8), label }),
  // Extra periods after a draw, when the match needs a winner.
  overtime: z.strictObject({ label }).nullable(),
  // The match ends as soon as someone reaches it (3x3 basketball).
  targetScore: count(200).nullable(),
  // At the target, a lead this large is needed (3x3 final: 21, by 2 from 20-20).
  targetWinBy: count(5).nullable(),
  // Whether a regular match may end level (group stages).
  allowDraw: z.boolean(),
  // Penalties after a draw, counted apart from the score.
  shootout: z.strictObject({ label, kicks: count(10) }).nullable(),
  clock: clockConfigSchema.nullable(),
});

/** Sets of points (badminton, table tennis, a Valorant map per set). */
export const setsConfigSchema = z.strictObject({
  engine: z.literal("sets"),
  pointsPerSet: count(99),
  winBy: count(5),
  // No set goes past this score (badminton 21).
  cap: count(99).nullable(),
  setsToWin: count(5),
  // A break when the leader reaches it (badminton 8).
  intervalAt: count(99).nullable(),
  setLabel: label,
});

/** Only who won each game counts (ROV, tug-of-war). */
export const seriesConfigSchema = z.strictObject({
  engine: z.literal("series"),
  gamesToWin: count(9),
  gameLabel: label,
  // Games are sub-matches of their own (table tennis team rubbers).
  fromSubMatches: z.boolean(),
});

/** Each end, one side scores (petanque). */
export const endsConfigSchema = z.strictObject({
  engine: z.literal("ends"),
  maxPerEnd: count(12),
  targetScore: count(99),
});

export const RACE_MEASURES = ["time", "distance", "placement"] as const;
export type RaceMeasure = (typeof RACE_MEASURES)[number];

/** Several sides ranked by a time, a distance or their placings (athletics, TFT). */
export const raceConfigSchema = z.strictObject({
  engine: z.literal("race"),
  measure: z.enum(RACE_MEASURES),
  // Times: lower wins. Distances and placement points: higher wins.
  lowerIsBetter: z.boolean(),
  // Points for 1st, 2nd, ... place in each game (TFT: 8 down to 1).
  placementPoints: z.array(z.number().int().min(0).max(100)).max(16).nullable(),
  // How many games a match has; each game's placings are added up.
  games: count(10),
  // With several games: the side winning more games wins, or the bigger total.
  decideBy: z.enum(["gameWins", "total"]),
});

export const scoringConfigSchema = z.discriminatedUnion("engine", [
  pointsConfigSchema,
  setsConfigSchema,
  seriesConfigSchema,
  endsConfigSchema,
  raceConfigSchema,
]);
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type PointsConfig = z.infer<typeof pointsConfigSchema>;
export type SetsConfig = z.infer<typeof setsConfigSchema>;
export type SeriesConfig = z.infer<typeof seriesConfigSchema>;
export type EndsConfig = z.infer<typeof endsConfigSchema>;
export type RaceConfig = z.infer<typeof raceConfigSchema>;
