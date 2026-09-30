// Every calendar time is shown in Bangkok time, whatever the device's zone.
// Bangkok is a fixed UTC+07:00 with no daylight saving, so day, week and month
// boundaries are plain offset arithmetic on epoch milliseconds.

import { CALENDAR_TIMEZONE } from "@it3k/db/calendar-rules";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const OFFSET_MS = 7 * HOUR_MS;

export type BangkokParts = {
  year: number;
  /** 0-11 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
};

export function bangkokParts(ms: number): BangkokParts {
  const shifted = new Date(ms + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: (shifted.getUTCDay() + 6) % 7,
  };
}

/** The instant a Bangkok wall-clock time happens. Out-of-range parts roll over. */
export function bangkokTime(year: number, month: number, day: number, hour = 0, minute = 0) {
  return Date.UTC(year, month, day, hour, minute) - OFFSET_MS;
}

export function startOfDay(ms: number) {
  const { year, month, day } = bangkokParts(ms);
  return bangkokTime(year, month, day);
}

/** Weeks start on Monday. */
export function startOfWeek(ms: number) {
  return startOfDay(ms) - bangkokParts(ms).weekday * DAY_MS;
}

export function startOfMonth(ms: number) {
  const { year, month } = bangkokParts(ms);
  return bangkokTime(year, month, 1);
}

export function addDays(ms: number, days: number) {
  return ms + days * DAY_MS;
}

/** Same day of the month, clamped to the target month's length. */
export function addMonths(ms: number, months: number) {
  const { year, month, day, hour, minute } = bangkokParts(ms);
  const lastDay = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return bangkokTime(year, month + months, Math.min(day, lastDay), hour, minute);
}

export function sameDay(a: number, b: number) {
  return startOfDay(a) === startOfDay(b);
}

/** Whole weeks (Monday to Sunday) covering the month that contains `ms`. */
export function monthGrid(ms: number): number[][] {
  const first = startOfMonth(ms);
  const next = addMonths(first, 1);
  const weeks: number[][] = [];
  for (let week = startOfWeek(first); week < next; week = addDays(week, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(week, index)));
  }
  return weeks;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` in Bangkok, as used in the page URL. */
export function dateKey(ms: number) {
  const { year, month, day } = bangkokParts(ms);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function fromDateKey(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const ms = bangkokTime(year, month - 1, day);
  return dateKey(ms) === key ? ms : null;
}

/** Value for `<input type="datetime-local">`, read as Bangkok time. */
export function toDatetimeLocal(ms: number) {
  const { hour, minute } = bangkokParts(ms);
  return `${dateKey(ms)}T${pad(hour)}:${pad(minute)}`;
}

export function fromDatetimeLocal(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const ms = bangkokTime(year, month - 1, day, hour, minute);
  return toDatetimeLocal(ms) === value.slice(0, 16) ? ms : null;
}

const formatters = {
  time: new Intl.DateTimeFormat("th-TH", {
    timeZone: CALENDAR_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }),
  day: new Intl.DateTimeFormat("th-TH", {
    timeZone: CALENDAR_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }),
  longDay: new Intl.DateTimeFormat("th-TH", {
    timeZone: CALENDAR_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
  month: new Intl.DateTimeFormat("th-TH", {
    timeZone: CALENDAR_TIMEZONE,
    month: "long",
    year: "numeric",
  }),
  weekday: new Intl.DateTimeFormat("th-TH", { timeZone: CALENDAR_TIMEZONE, weekday: "short" }),
  date: new Intl.DateTimeFormat("th-TH", {
    timeZone: CALENDAR_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }),
  dateTime: new Intl.DateTimeFormat("th-TH", {
    timeZone: CALENDAR_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }),
};

export type DateStyle = keyof typeof formatters;

export function formatBangkok(ms: number, style: DateStyle) {
  return formatters[style].format(ms);
}

/** "13:00–15:00", with the end's date when the range crosses midnight. */
export function formatRange(start: number, end: number) {
  const endLabel = sameDay(start, end - 1)
    ? formatBangkok(end, "time")
    : formatBangkok(end, "dateTime");
  return `${formatBangkok(start, "time")}–${endLabel}`;
}
