import { cn } from "@it3k/ui/lib/utils";
import { CalendarDays, MapPin } from "lucide-react";

import { CALENDAR_TIMEZONE } from "@it3k/db/calendar-rules";

import { formatBangkok, formatRange } from "@/lib/bangkok-time";

/** "ส. 5 ธ.ค. · 09:00–12:00", Bangkok time. */
export function EventWhen({ startAt, endAt }: { startAt: string; endAt: string }) {
  const start = Date.parse(startAt);
  return (
    <span className="flex items-center gap-2">
      <CalendarDays className="size-4 shrink-0" aria-hidden />
      {formatBangkok(start, "day")} · {formatRange(start, Date.parse(endAt))}
    </span>
  );
}

export function EventWhere({ venue }: { venue: { name: string } | null }) {
  if (!venue) return null;
  return (
    <span className="flex items-center gap-2">
      <MapPin className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{venue.name}</span>
    </span>
  );
}

const chipParts = new Intl.DateTimeFormat("th-TH", {
  timeZone: CALENDAR_TIMEZONE,
  day: "numeric",
  month: "short",
});

/** A calendar-page chip, "5 / ธ.ค.", laid over an event's picture. */
export function EventDateChip({ startAt, className }: { startAt: string; className?: string }) {
  const parts = chipParts.formatToParts(Date.parse(startAt));
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return (
    <span
      aria-hidden
      className={cn(
        "flex min-w-12 flex-col items-center rounded-xl bg-white px-2 py-1 leading-none text-black shadow-md",
        className,
      )}
    >
      <span className="text-xl font-bold">{day}</span>
      <span className="text-xs font-medium text-red-600">{month}</span>
    </span>
  );
}
