// Calendar rules shared by the API and the web app. Kept free of Drizzle so
// the browser bundle can import it.

/** A draft is still being worked out; confirmed is final; cancelled stays visible. */
export const CALENDAR_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export const CALENDAR_VISIBILITIES = ["internal", "public"] as const;
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number];

export const CALENDAR_TIMEZONE = "Asia/Bangkok";

export const CALENDAR_CHANGE_ACTIONS = [
  "create",
  "update",
  "reschedule",
  "status",
  "cancel",
  "publish",
  "delete",
] as const;
export type CalendarChangeAction = (typeof CALENDAR_CHANGE_ACTIONS)[number];

/**
 * Why someone is told about an item: they were made its owner, their
 * department was asked to work on it, or it moved or was cancelled.
 */
export const NOTIFICATION_KINDS = ["assignment", "collaboration", "reschedule", "cancel"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Most departments one item may name as working on it with its own. */
export const MAX_COLLABORATORS = 20;

/** Only confirmed items may be public; a draft or a cancellation never is. */
export function canBePublic(item: { status: CalendarStatus }) {
  return item.status === "confirmed";
}
