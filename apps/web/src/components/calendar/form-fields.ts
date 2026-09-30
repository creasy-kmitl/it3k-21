// Which details the item form asks for, by what the item is. A match needs
// teams and a stream; a meeting needs an agenda; a release needs its plan.
import type { CalendarCategory, CalendarMode } from "@it3k/db/calendar-rules";

export const CONTEXT_FIELDS = [
  "game",
  "matchId",
  "teams",
  "venue",
  "streamPlatform",
  "scoreboardUrl",
  "onCallOwnerId",
  "scoreboardOperatorId",
  "template",
  "meetingLink",
  "agenda",
  "feature",
  "environment",
  "specUrl",
  "designUrl",
  "pullRequestUrl",
  "qaUrl",
  "qaResult",
  "monitoringOwnerId",
  "incidentUrl",
  "rolloutPlan",
  "rollbackPlan",
] as const;
export type ContextField = (typeof CONTEXT_FIELDS)[number];

/** Fields that take the full width of the section. */
export const WIDE_FIELDS: ReadonlySet<ContextField> = new Set([
  "template",
  "agenda",
  "rolloutPlan",
  "rollbackPlan",
]);

const MEETING: ContextField[] = ["template", "meetingLink", "agenda"];

const BY_CATEGORY: Record<CalendarCategory, ContextField[]> = {
  match: [
    "game",
    "matchId",
    "teams",
    "venue",
    "streamPlatform",
    "scoreboardUrl",
    "onCallOwnerId",
    "scoreboardOperatorId",
  ],
  broadcast: ["game", "matchId", "venue", "streamPlatform", "onCallOwnerId"],
  result_update: ["game", "matchId", "teams", "scoreboardUrl", "scoreboardOperatorId"],
  technical_check: ["venue", "streamPlatform", "onCallOwnerId"],
  rehearsal: ["venue", "streamPlatform", "onCallOwnerId", "template", "agenda"],
  cross_team_meeting: MEETING,
  handoff: ["meetingLink", "agenda"],
  approval: ["meetingLink", "agenda"],
  information_request: ["meetingLink", "agenda"],
  planning: MEETING,
  design: ["feature", "specUrl", "designUrl"],
  development: ["feature", "specUrl", "designUrl", "pullRequestUrl"],
  code_review: ["feature", "pullRequestUrl"],
  qa: ["feature", "environment", "qaUrl", "qaResult"],
  release: [
    "feature",
    "environment",
    "specUrl",
    "pullRequestUrl",
    "qaUrl",
    "qaResult",
    "monitoringOwnerId",
    "rolloutPlan",
    "rollbackPlan",
  ],
  monitoring: ["feature", "environment", "incidentUrl"],
  incident: ["meetingLink", "agenda", "incidentUrl"],
  post_event_review: [...MEETING, "incidentUrl"],
};

/**
 * The details that apply to an item. A few categories mean different things
 * in different modes: planning is a meeting, or feature work in delivery; an
 * incident is live trouble, a broken release, or a review meeting.
 */
export function fieldsFor(mode: CalendarMode, category: CalendarCategory): ContextField[] {
  if (category === "planning" && mode === "delivery") return ["feature", "specUrl", "designUrl"];
  if (category === "incident" && mode === "operations") {
    return ["venue", "streamPlatform", "onCallOwnerId", "incidentUrl"];
  }
  if (category === "incident" && mode === "delivery") {
    return ["feature", "environment", "pullRequestUrl", "incidentUrl"];
  }
  return BY_CATEGORY[category];
}
