// Competition rules shared by the API and the web app: teams, matches,
// schedules, check-in and standings. Kept free of Drizzle so the browser bundle
// can import it. Values that may grow (statuses, outcomes) are checked here,
// not by CHECK constraints, so adding one never rebuilds a table.
import { z } from "zod";

import { imageUrlSchema } from "./image-url";
import { INSTITUTION_IDS } from "./profile";
import { scoringConfigSchema } from "./scoring/config";
import { PARTICIPANT_OUTCOMES, scoreEventInputSchema } from "./scoring/types";

export * from "./scoring/config";
export * from "./scoring/types";

export const MATCH_STATUSES = [
  "scheduled",
  "checkin",
  "live",
  "finished",
  "postponed",
  "cancelled",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "ยังไม่เริ่ม",
  checkin: "เปิดรายงานตัว",
  live: "กำลังแข่ง",
  finished: "จบแล้ว",
  postponed: "เลื่อน",
  cancelled: "ยกเลิก",
};

/** How a finished match ended. */
export const MATCH_OUTCOMES = ["played", "walkover", "forfeit", "no_contest"] as const;
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number];

export const MATCH_OUTCOME_LABELS: Record<MatchOutcome, string> = {
  played: "แข่งจบตามปกติ",
  walkover: "ชนะผ่าน",
  forfeit: "ปรับแพ้",
  no_contest: "ไม่มีผล",
};

export const PARTICIPANT_OUTCOME_LABELS: Record<(typeof PARTICIPANT_OUTCOMES)[number], string> = {
  win: "ชนะ",
  loss: "แพ้",
  draw: "เสมอ",
  walkover_win: "ชนะผ่าน",
  forfeit: "ปรับแพ้",
};

export const LINEUP_ROLES = ["starter", "sub"] as const;
export type LineupRole = (typeof LINEUP_ROLES)[number];

export const LINEUP_ROLE_LABELS: Record<LineupRole, string> = {
  starter: "ตัวจริง",
  sub: "ตัวสำรอง",
};

/** Kiosk: athletes scan in at the venue. Manual: staff tick them (esports, via Discord). */
export const CHECKIN_MODES = ["kiosk", "manual"] as const;
export type CheckinMode = (typeof CHECKIN_MODES)[number];

export const CHECKIN_METHODS = ["scan", "manual"] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

/** Ways to order teams on equal points, tried in the order a division lists them. */
export const TIEBREAKS = [
  "headToHead",
  "scoreDiff",
  "scoreFor",
  "wins",
  "setRatio",
  "pointRatio",
] as const;
export type Tiebreak = (typeof TIEBREAKS)[number];

export const TIEBREAK_LABELS: Record<Tiebreak, string> = {
  headToHead: "ผลการพบกัน",
  scoreDiff: "ผลต่างคะแนนได้-เสีย",
  scoreFor: "คะแนนได้",
  wins: "จำนวนครั้งที่ชนะ",
  setRatio: "อัตราส่วนเซตได้-เสีย",
  pointRatio: "อัตราส่วนแต้มได้-เสีย",
};

/** Group table points, e.g. football 3/1/0 and basketball 2/1/0. */
export const standingsConfigSchema = z.strictObject({
  win: z.number().int().min(0).max(10),
  draw: z.number().int().min(0).max(10),
  loss: z.number().int().min(0).max(10),
  // A side that did not turn up or was disqualified.
  forfeit: z.number().int().min(0).max(10),
  tiebreaks: z.array(z.enum(TIEBREAKS)).max(TIEBREAKS.length),
});
export type StandingsConfig = z.infer<typeof standingsConfigSchema>;

/** Places 1 to 4 earn these points towards the overall table (regulation, หมวด 9). */
export const MEDAL_POINTS = [4, 3, 2, 1] as const;
/** A division with fewer teams is a friendly: no medals or points. */
export const MIN_TEAMS_FOR_MEDALS = 3;

export const genderMinimumsSchema = z.strictObject({
  male: z.number().int().min(0).max(50).optional(),
  female: z.number().int().min(0).max(50).optional(),
});
export type GenderMinimums = z.infer<typeof genderMinimumsSchema>;

const size = z.number().int().min(1).max(100);
const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);

/** Everything about how a division competes, as staff edit it. */
export const divisionCompetitionInput = z
  .strictObject({
    maxTeamsPerInstitution: z.number().int().min(1).max(20),
    teamMinSize: size.nullable(),
    teamMaxSize: size.nullable(),
    genderMinimums: genderMinimumsSchema.nullable(),
    maxOfficials: z.number().int().min(0).max(20),
    lineupStarters: size.nullable(),
    lineupMaxSubs: z.number().int().min(0).max(100).nullable(),
    scoringConfig: scoringConfigSchema.nullable(),
    standingsConfig: standingsConfigSchema.nullable(),
    checkinMode: z.enum(CHECKIN_MODES),
    checkinOpensMin: minutes,
    checkinClosesMin: minutes,
    checkinMinPlayers: size.nullable(),
    awardsMedals: z.boolean(),
    // The version read; a save based on an older one is refused.
    version: z.number().int().min(1),
  })
  .refine(
    (v) => v.teamMinSize === null || v.teamMaxSize === null || v.teamMinSize <= v.teamMaxSize,
    {
      message: "จำนวนขั้นต่ำต้องไม่เกินจำนวนสูงสุด",
      path: ["teamMinSize"],
    },
  )
  .refine((v) => v.checkinClosesMin < v.checkinOpensMin, {
    message: "ต้องปิดรายงานตัวหลังเปิด",
    path: ["checkinClosesMin"],
  });
export type DivisionCompetitionInput = z.infer<typeof divisionCompetitionInput>;

const id = z.string().min(1);
const shortText = (max: number) => z.string().trim().min(1, "กรอกข้อมูล").max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const version = z.number().int().min(0);
const sortOrder = z.number().int().min(0).max(10_000);

// Teams -------------------------------------------------------------------

export const teamCreateInput = z.strictObject({
  divisionId: id,
  institution: z.enum(INSTITUTION_IDS),
  // Null takes the next free team number.
  seq: z.number().int().min(1).max(20).nullable(),
  name: optionalText(60),
});

/** The whole member list at once, so a save never mixes two editors' lists. */
export const teamMembersInput = z.strictObject({
  registrationIds: z.array(id).max(100),
  version,
});

export const teamOfficialInput = z.strictObject({
  name: shortText(100),
  position: optionalText(60),
  description: optionalText(500),
  photoUrl: imageUrlSchema.nullable(),
  sortOrder,
});

export const lineupInput = z.strictObject({
  starters: z.array(id).max(100),
  subs: z.array(id).max(100),
});

// Matches and schedules ---------------------------------------------------

export const groupInput = z.strictObject({
  divisionId: id,
  stageName: shortText(60),
  name: shortText(40),
  teamIds: z.array(id).max(64),
  sortOrder,
});

/** Which side of an earlier match fills a knockout slot. */
export const SIDE_SOURCES = ["winner", "loser"] as const;
export type SideSource = (typeof SIDE_SOURCES)[number];

export const SIDE_SOURCE_LABELS: Record<SideSource, string> = {
  winner: "ผู้ชนะ",
  loser: "ผู้แพ้",
};

export const sideSourceInput = z.strictObject({
  matchId: id,
  result: z.enum(SIDE_SOURCES),
});

export const matchParticipantInput = z
  .strictObject({
    teamId: id.nullable(),
    // A placeholder until the team is known, e.g. "ผู้ชนะ M3".
    label: optionalText(60),
    // The match whose winner or loser takes this side; the bracket view draws from it.
    source: sideSourceInput.nullable().optional(),
  })
  .refine((p) => p.teamId !== null || (p.label ?? "") !== "" || p.source != null, {
    message: "เลือกทีมหรือใส่ชื่อชั่วคราว",
  });

export const matchInput = z.strictObject({
  divisionId: id,
  parentMatchId: id.nullable(),
  groupId: id.nullable(),
  stageName: shortText(60),
  roundNo: z.number().int().min(1).max(100).nullable(),
  matchNo: z.number().int().min(1).max(10_000).nullable(),
  startAt: z.number().int().min(0).nullable(),
  venueId: id.nullable(),
  court: optionalText(40),
  friendly: z.boolean(),
  scoringConfig: scoringConfigSchema.nullable(),
  notes: optionalText(1000),
  participants: z.array(matchParticipantInput).min(1).max(16),
});
export type MatchInput = z.infer<typeof matchInput>;

/** Statuses staff set by hand; live and finished come from scoring. */
export const MANUAL_MATCH_STATUSES = ["scheduled", "checkin", "postponed", "cancelled"] as const;

export const matchStatusInput = z.strictObject({
  status: z.enum(MANUAL_MATCH_STATUSES),
  version,
});

export const refereeInput = z.strictObject({
  name: shortText(100),
  role: shortText(60),
  sortOrder,
});

export const matchImageInput = z.strictObject({
  url: imageUrlSchema,
  caption: optionalText(200),
  isCover: z.boolean(),
  sortOrder,
});

export const placementsInput = z.strictObject({
  divisionId: id,
  places: z.array(z.strictObject({ teamId: id, place: z.number().int().min(1).max(64) })).max(64),
});

// Scoring -----------------------------------------------------------------

export const scoreEventsInput = z.strictObject({
  events: z.array(scoreEventInputSchema).min(1).max(100),
});

export const finishMatchInput = z.strictObject({
  // Finish although the engine does not see a winner yet (staff decided).
  force: z.boolean(),
  version,
});

/** A result without play: a walkover, a forfeit, or ranks typed in by hand. */
export const matchResultInput = z.strictObject({
  outcome: z.enum(["walkover", "forfeit", "no_contest", "played"]),
  ranks: z
    .array(
      z.strictObject({
        participantId: id,
        rank: z.number().int().min(1).max(64).nullable(),
        outcome: z.enum(PARTICIPANT_OUTCOMES).nullable(),
      }),
    )
    .max(16),
  version,
});

// Check-in ----------------------------------------------------------------

export const matchCheckinScanInput = z.strictObject({ code: z.string().trim().min(1).max(200) });
export const matchCheckinManualInput = z.strictObject({
  participantId: id,
  userId: id,
});
