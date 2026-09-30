// "Add to calendar" for one item: links that open Google Calendar or Outlook
// with the event filled in, and an .ics file for Apple Calendar and the rest.
// Built in the browser, so nothing about the item leaves the team unless the
// viewer adds it to their own calendar. Internal notes are never included.
import { CALENDAR_TIMEZONE } from "@it3k/db/calendar-rules";

import { dateKey } from "./bangkok-time";
import type { CalendarItem } from "./calendar";
import { STATUS_LABELS } from "./calendar-labels";

export type CalendarEvent = {
  uid: string;
  title: string;
  startAt: number;
  endAt: number;
  location: string | null;
  details: string;
  url: string;
  updatedAt: number;
};

/** The event an item becomes in someone's own calendar. */
export function eventFor(
  item: Pick<
    CalendarItem,
    | "id"
    | "title"
    | "status"
    | "startAt"
    | "endAt"
    | "venue"
    | "department"
    | "collaborators"
    | "updatedAt"
  >,
  origin: string,
): CalendarEvent {
  const url = `${origin}/staff/calendar?view=day&date=${dateKey(item.startAt)}&item=${item.id}`;
  const details = [
    `แผนก: ${item.department.name}`,
    item.collaborators.length > 0
      ? `ทำงานร่วมกับ: ${item.collaborators.map((d) => d.name).join(", ")}`
      : null,
    `ดูในปฏิทิน IT3K: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    uid: `${item.id}@it3k`,
    // A draft is not final; say so wherever it is copied to.
    title: item.status === "draft" ? `[${STATUS_LABELS.draft}] ${item.title}` : item.title,
    startAt: item.startAt,
    endAt: item.endAt,
    location: item.venue,
    details,
    url,
    updatedAt: item.updatedAt,
  };
}

/** `20261010T060000Z` */
function utcStamp(ms: number) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** `2026-10-10T06:00:00Z` */
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}/, "");

export function googleCalendarUrl(event: CalendarEvent) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${utcStamp(event.startAt)}/${utcStamp(event.endAt)}`,
    details: event.details,
    ctz: CALENDAR_TIMEZONE,
  });
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Outlook.com for personal accounts, or Microsoft 365 for work and school ones. */
export function outlookUrl(event: CalendarEvent, account: "personal" | "work") {
  const host = account === "personal" ? "outlook.live.com" : "outlook.office.com";
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: isoSeconds(event.startAt),
    enddt: isoSeconds(event.endAt),
    body: event.details,
  });
  if (event.location) params.set("location", event.location);
  return `https://${host}/calendar/0/deeplink/compose?${params}`;
}

/** Escapes TEXT values (RFC 5545 §3.3.11). */
function icsText(value: string) {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      // Any line break, including a lone CR, which a client could read as a new line.
      .replace(/\r\n|\r|\n/g, "\\n")
  );
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting a character (§3.1). */
function fold(line: string) {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * One event as an iCalendar file. The UID is the item's, so adding the same
 * item again updates the event instead of duplicating it.
 */
export function icsFile(event: CalendarEvent, now: number) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IT3K//Calendar//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `LAST-MODIFIED:${utcStamp(event.updatedAt)}`,
    `DTSTART:${utcStamp(event.startAt)}`,
    `DTEND:${utcStamp(event.endAt)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    `DESCRIPTION:${icsText(event.details)}`,
    `URL:${event.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** A file name the item's title can be read from, safe on every system. */
export function icsFileName(title: string) {
  // Control characters become separators too; checked by code, not a regex.
  const printable = [...title].map((char) => (char < " " ? "|" : char)).join("");
  const safe = printable
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim()
    .slice(0, 80);
  return `${safe || "it3k-event"}.ics`;
}

/** Saves the event as an .ics file; Apple devices offer to add it to Calendar. */
export function downloadIcs(event: CalendarEvent, title: string, now = Date.now()) {
  const blob = new Blob([icsFile(event, now)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = icsFileName(title);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
