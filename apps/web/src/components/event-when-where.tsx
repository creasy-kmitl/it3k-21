import { CalendarDays, MapPin } from "lucide-react";

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
      {venue.name}
    </span>
  );
}
