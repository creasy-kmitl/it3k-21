// Calendar rules shared by the API and the web app. Kept free of Drizzle so
// the browser bundle can import it.

/** The four views of one dataset: every item belongs to exactly one mode. */
export const CALENDAR_MODES = ["operations", "coordination", "delivery", "meetings"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export const CALENDAR_CATEGORIES = [
  "match",
  "broadcast",
  "result_update",
  "technical_check",
  "rehearsal",
  "cross_team_meeting",
  "handoff",
  "approval",
  "information_request",
  "planning",
  "design",
  "development",
  "code_review",
  "qa",
  "release",
  "monitoring",
  "incident",
  "post_event_review",
] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

/** Which categories each mode accepts, so matches, meetings and releases never mix. */
export const CATEGORIES_BY_MODE: Record<CalendarMode, readonly CalendarCategory[]> = {
  operations: ["match", "broadcast", "result_update", "technical_check", "rehearsal", "incident"],
  coordination: ["cross_team_meeting", "handoff", "approval", "information_request"],
  delivery: [
    "planning",
    "design",
    "development",
    "code_review",
    "qa",
    "release",
    "monitoring",
    "incident",
  ],
  meetings: ["planning", "rehearsal", "cross_team_meeting", "post_event_review", "incident"],
};

export const OPERATIONAL_STATUSES = [
  "draft",
  "confirmed",
  "ready",
  "live",
  "completed",
  "delayed",
  "cancelled",
] as const;
export const DELIVERY_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "in_review",
  "qa",
  "ready_to_release",
  "released",
  "rolled_back",
] as const;
export const CALENDAR_STATUSES = [...OPERATIONAL_STATUSES, ...DELIVERY_STATUSES] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

/** Delivery work moves through a release pipeline; everything else is scheduled. */
export function statusesFor(mode: CalendarMode): readonly CalendarStatus[] {
  return mode === "delivery" ? DELIVERY_STATUSES : OPERATIONAL_STATUSES;
}

export const GAMES = ["tft", "valorant", "rov"] as const;
export type Game = (typeof GAMES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CALENDAR_VISIBILITIES = ["internal", "public"] as const;
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number];

export const CALENDAR_TIMEZONE = "Asia/Bangkok";

export const CALENDAR_CHANGE_ACTIONS = [
  "create",
  "update",
  "reschedule",
  "status",
  "cancel",
  "archive",
  "unarchive",
  "duplicate",
  "confirm",
  "publish",
] as const;
export type CalendarChangeAction = (typeof CALENDAR_CHANGE_ACTIONS)[number];

/**
 * Unconfirmed data is shown as TBD and must never be treated as final: a
 * draft, or anything nobody has confirmed yet.
 */
export function isTbd(item: { status: CalendarStatus; lastConfirmedAt: Date | null }) {
  return item.status === "draft" || item.lastConfirmedAt === null;
}
