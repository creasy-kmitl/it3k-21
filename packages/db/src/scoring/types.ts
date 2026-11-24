// What a scorer sends and what an engine works out from it. A match's score is
// never written over: every tap adds an event, undo voids one, and the engines
// replay the events that are left.
import { z } from "zod";

const participantId = z.string().min(1);
const registrationId = z.string().min(1).nullable();
const game = z.number().int().min(1).max(10);

export const SCORE_STATS = ["foul", "timeout", "yellow", "red"] as const;
export type ScoreStat = (typeof SCORE_STATS)[number];

export const RACE_STATUSES = ["ok", "dns", "dnf", "dq"] as const;
export type RaceStatus = (typeof RACE_STATUSES)[number];

/** One event's own data, by `type`. */
export const scoreEventPayloadSchema = z.discriminatedUnion("type", [
  // Points for a side: a goal, a basket, a rally, an end.
  z.strictObject({
    type: z.literal("score"),
    participantId,
    points: z.number().int().min(1).max(12),
    registrationId,
  }),
  // The scorer moves on to the next period, set or end by hand.
  z.strictObject({ type: z.literal("period"), period: z.number().int().min(1).max(20) }),
  // A side won one game of a series.
  z.strictObject({ type: z.literal("game"), participantId }),
  // A race result: a time in ms or a distance in mm.
  z.strictObject({
    type: z.literal("result"),
    participantId,
    value: z.number().int().min(0).nullable(),
    status: z.enum(RACE_STATUSES),
  }),
  // A placing in one game; per athlete when a side has several (TFT).
  z.strictObject({
    type: z.literal("placement"),
    participantId,
    registrationId,
    game,
    place: z.number().int().min(1).max(16),
  }),
  // One penalty kick or throw after a draw.
  z.strictObject({ type: z.literal("shootout"), participantId, scored: z.boolean() }),
  // A foul, a timeout or a card; shown, but not part of the score.
  z.strictObject({
    type: z.literal("stat"),
    participantId,
    stat: z.enum(SCORE_STATS),
    registrationId,
  }),
  z.strictObject({
    type: z.literal("clock"),
    action: z.enum(["start", "pause", "reset"]),
    // Seconds left (or gone) when it happened, as the scorer's clock read.
    seconds: z
      .number()
      .int()
      .min(0)
      .max(4 * 60 * 60),
  }),
]);
export type ScoreEventPayload = z.infer<typeof scoreEventPayloadSchema>;
export type ScoreEventType = ScoreEventPayload["type"];

/**
 * What the scorer posts. The id is made on the phone, so a retry after a
 * dropped connection cannot count twice.
 */
export const scoreEventInputSchema = z.strictObject({
  id: z.uuid(),
  clientAt: z.number().int().min(0),
  payload: scoreEventPayloadSchema,
});
export type ScoreEventInput = z.infer<typeof scoreEventInputSchema>;

/** An event as the engines see it, in the order the server took them. */
export type ScoreEventRecord = {
  id: string;
  seq: number;
  payload: ScoreEventPayload;
  voided: boolean;
  createdAt: number;
};

export const PARTICIPANT_OUTCOMES = ["win", "loss", "draw", "walkover_win", "forfeit"] as const;
export type ParticipantOutcome = (typeof PARTICIPANT_OUTCOMES)[number];

/** The breakdown kept with each side's score, for the scoreboard. */
export type ParticipantDetail = {
  // Points per period, set, end or game, in order.
  parts?: number[];
  // Sets or games won.
  won?: number;
  shootout?: { scored: number; taken: number };
  stats?: Partial<Record<ScoreStat, number>>;
  // Race only.
  status?: RaceStatus;
};

export type ParticipantState = {
  participantId: string;
  score: number | null;
  detail: ParticipantDetail | null;
  // A race time in ms or a distance in mm.
  resultValue: number | null;
  rank: number | null;
  outcome: ParticipantOutcome | null;
};

export type MatchPhase = "regular" | "overtime" | "shootout";

export type ClockState = {
  running: boolean;
  seconds: number;
  // When the clock last started, by the server's clock; null while paused.
  startedAt: number | null;
};

export type TimelineEntry = {
  eventId: string;
  at: number;
  period: number;
  participantId: string | null;
  // A short line for the public timeline, e.g. "+3" or "ใบเหลือง".
  text: string;
  registrationId: string | null;
};

export type MatchState = {
  participants: ParticipantState[];
  // The period, set, end or game being played, from 1.
  period: number;
  phase: MatchPhase;
  // The engine's rules say the match is over; finishing still needs a person.
  decided: boolean;
  clock: ClockState | null;
  timeline: TimelineEntry[];
};

/** The sides of a match, in slot order. */
export type EngineParticipant = { id: string };

/** A sub-match's result, for series built from sub-matches. */
export type SubMatchResult = { winnerParticipantId: string | null };

export type EngineInput<C> = {
  config: C;
  participants: EngineParticipant[];
  events: ScoreEventRecord[];
  subMatches?: SubMatchResult[];
};
