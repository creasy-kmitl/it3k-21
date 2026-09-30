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
  // Coordination: department requests, action items and decisions.
  "request",
  "answer",
  "action_item",
  "decision",
  // Live readiness.
  "checklist",
] as const;
export type CalendarChangeAction = (typeof CALENDAR_CHANGE_ACTIONS)[number];

/**
 * Unconfirmed data is shown as TBD and must never be treated as final: a
 * draft, or anything nobody has confirmed yet.
 */
export function isTbd(item: { status: CalendarStatus; lastConfirmedAt: Date | null }) {
  return item.status === "draft" || item.lastConfirmedAt === null;
}

/**
 * What an involved department owes: nothing yet (`involved`), information or
 * work Tech/Live is waiting on (`requested`), or its answer (`answered`).
 */
export const REQUEST_STATES = ["involved", "requested", "answered"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const ACTION_ITEM_STATUSES = ["open", "done"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

/** Recurring rituals: a daily check-in or a weekly sync, created as a series of items. */
export const REPEAT_UNITS = ["day", "week"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];
export const MAX_REPEAT_COUNT = 26;

/**
 * Meetings and handoffs must leave a trace: before one is marked completed it
 * needs an agenda, an owner, the departments involved and at least one
 * decision or action item.
 */
export function needsCloseOut(item: { mode: CalendarMode; category: CalendarCategory }) {
  return (
    item.mode === "meetings" ||
    item.category === "cross_team_meeting" ||
    item.category === "handoff"
  );
}

/** What must be checked before a match, broadcast or technical check goes live. */
export const LIVE_CHECKLIST = [
  "network",
  "audio",
  "overlay",
  "stream",
  "scoreboard",
  "backup",
  "times",
] as const;
export type LiveChecklistKey = (typeof LIVE_CHECKLIST)[number];

const LIVE_CHECKLIST_CATEGORIES: readonly CalendarCategory[] = [
  "match",
  "broadcast",
  "technical_check",
];

export function needsLiveChecklist(item: { category: CalendarCategory }) {
  return LIVE_CHECKLIST_CATEGORIES.includes(item.category);
}

/** Statuses that claim an item is ready to go live, so the checklist must be done. */
export const READY_STATUSES: readonly CalendarStatus[] = ["ready", "live"];

/**
 * Items that hold people, rooms and streams for a fixed slot, so they can
 * clash. Long-running delivery work (design, development…) does not.
 */
export function holdsASlot(item: { mode: CalendarMode }) {
  return item.mode !== "delivery";
}

/** What two items can clash over. */
export const CONFLICT_KINDS = ["person", "venue", "stream"] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];
