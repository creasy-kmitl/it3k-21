// The public calendar: approved, confirmed live operations only, with a field
// whitelist. No session is needed, so nothing here may reveal private data.
import type { Database } from "@it3k/db";
import {
  CALENDAR_TIMEZONE,
  type CalendarStatus,
  calendarItem,
  publicStatus,
} from "@it3k/db/schema/calendar";
import { and, eq, gt, isNotNull, isNull, lt, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { validate } from "../../middleware/validation";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 62 * DAY_MS;
const DEFAULT_BACK_MS = DAY_MS;
const DEFAULT_AHEAD_MS = 30 * DAY_MS;
/** The subscription feed covers a wider window than one page. */
const FEED_BACK_MS = 7 * DAY_MS;
const FEED_AHEAD_MS = 90 * DAY_MS;
const LIMIT = 500;
const CACHE = "public, max-age=60";

const epochMs = z.coerce
  .number()
  .int()
  .min(Date.UTC(2020, 0, 1))
  .max(Date.UTC(2100, 0, 1));

const listQuery = z
  .strictObject({ from: epochMs.optional(), to: epochMs.optional() })
  .refine((q) => !q.from || !q.to || (q.to > q.from && q.to - q.from <= MAX_RANGE_MS), {
    message: "The range must be forwards and at most 62 days",
  });

/**
 * Published, approved and confirmed (not TBD) live operations. Delivery work,
 * meetings and anything archived never leave the team.
 */
function published() {
  return and(
    eq(calendarItem.visibility, "public"),
    isNotNull(calendarItem.approvedAt),
    isNotNull(calendarItem.lastConfirmedAt),
    ne(calendarItem.status, "draft"),
    eq(calendarItem.mode, "operations"),
    isNull(calendarItem.archivedAt),
  );
}

/** The only fields the public ever sees. */
const publicFields = {
  id: calendarItem.id,
  title: calendarItem.title,
  category: calendarItem.category,
  status: calendarItem.status,
  startAt: calendarItem.startAt,
  endAt: calendarItem.endAt,
  game: calendarItem.game,
  matchId: calendarItem.matchId,
  teams: calendarItem.teams,
  venue: calendarItem.venue,
  streamPlatform: calendarItem.streamPlatform,
  scoreboardUrl: calendarItem.scoreboardUrl,
  updatedAt: calendarItem.updatedAt,
};

async function publicItems(db: Database, from: number, to: number) {
  const rows = await db
    .select(publicFields)
    .from(calendarItem)
    .where(
      and(
        published(),
        lt(calendarItem.startAt, new Date(to)),
        gt(calendarItem.endAt, new Date(from)),
      ),
    )
    .orderBy(calendarItem.startAt, calendarItem.id)
    .limit(LIMIT);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    status: publicStatus(row.status as CalendarStatus),
    startAt: row.startAt.getTime(),
    endAt: row.endAt.getTime(),
    game: row.game,
    matchId: row.matchId,
    teams: row.teams ?? [],
    venue: row.venue,
    streamPlatform: row.streamPlatform,
    scoreboardUrl: row.scoreboardUrl,
    updatedAt: row.updatedAt.getTime(),
  }));
}

export type PublicCalendarItem = Awaited<ReturnType<typeof publicItems>>[number];

/** `20261010T060000Z` */
function icsTime(ms: number) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Escapes TEXT values (RFC 5545 §3.3.11). */
function icsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
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

export function toIcs(items: PublicCalendarItem[], now: number) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IT3K//Tech Live Calendar//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:IT3K Tech/Live",
    `X-WR-TIMEZONE:${CALENDAR_TIMEZONE}`,
  ];
  for (const item of items) {
    const description = [
      item.teams.length > 0 ? item.teams.join(" vs ") : null,
      item.matchId ? `Match ID: ${item.matchId}` : null,
      item.streamPlatform ? `Stream: ${item.streamPlatform}` : null,
      item.scoreboardUrl ? `Scoreboard: ${item.scoreboardUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.id}@it3k`,
      `DTSTAMP:${icsTime(now)}`,
      `LAST-MODIFIED:${icsTime(item.updatedAt)}`,
      `DTSTART:${icsTime(item.startAt)}`,
      `DTEND:${icsTime(item.endAt)}`,
      `SUMMARY:${icsText(item.title)}`,
      `STATUS:${item.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      ...(item.venue ? [`LOCATION:${icsText(item.venue)}`] : []),
      ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
      ...(item.scoreboardUrl ? [`URL:${item.scoreboardUrl}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

export const createPublicCalendarRoutes = (deps: { getDb: () => Database }) =>
  new Hono()
    .get("/", validate("query", listQuery), async (c) => {
      const { from, to } = c.req.valid("query");
      const now = Date.now();
      const start = from ?? (to ? to - MAX_RANGE_MS : now - DEFAULT_BACK_MS);
      const end = to ?? Math.min(start + MAX_RANGE_MS, now + DEFAULT_AHEAD_MS);
      const items = await publicItems(deps.getDb(), start, Math.max(end, start + 1));
      c.header("Cache-Control", CACHE);
      return c.json({ items, from: start, to: end, timezone: CALENDAR_TIMEZONE }, 200);
    })

    .get("/calendar.ics", async (c) => {
      const now = Date.now();
      const items = await publicItems(deps.getDb(), now - FEED_BACK_MS, now + FEED_AHEAD_MS);
      c.header("Cache-Control", CACHE);
      c.header("Content-Type", "text/calendar; charset=utf-8");
      c.header("Content-Disposition", 'inline; filename="it3k-tech-live.ics"');
      return c.body(toIcs(items, now));
    });

export type PublicCalendarRoutes = ReturnType<typeof createPublicCalendarRoutes>;
