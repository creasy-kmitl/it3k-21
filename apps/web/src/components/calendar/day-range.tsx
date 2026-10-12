import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatBangkok, formatRange, portionOnDay } from "@/lib/bangkok-time";

type Range = { startAt: number; endAt: number };

const FROM_BEFORE = "ต่อจากวันก่อน";
const INTO_NEXT = "ต่อถึงวันถัดไป";

/** An item's time on one day, in words: its part of the day, and where it carries on. */
export function describeDayRange(range: Range, day?: number) {
  if (day === undefined) return formatRange(range.startAt, range.endAt);
  const part = portionOnDay(range, day);
  return [
    formatRange(part.startAt, part.endAt),
    part.fromBefore && `(${FROM_BEFORE})`,
    part.intoNext && `(${INTO_NEXT})`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The part of an item that falls on `day`, with arrows where it carries on
 * from the day before or into the next. `startOnly` shows just the start.
 */
export function DayRange({
  range,
  day,
  startOnly = false,
}: {
  range: Range;
  day?: number;
  startOnly?: boolean;
}) {
  const part =
    day === undefined ? { ...range, fromBefore: false, intoNext: false } : portionOnDay(range, day);
  return (
    <span className="inline-flex items-center gap-0.5">
      {part.fromBefore && (
        <>
          <ChevronLeft aria-hidden className="size-3 shrink-0" />
          <span className="sr-only">{FROM_BEFORE} </span>
        </>
      )}
      {startOnly ? formatBangkok(part.startAt, "time") : formatRange(part.startAt, part.endAt)}
      {part.intoNext && (
        <>
          <ChevronRight aria-hidden className="size-3 shrink-0" />
          <span className="sr-only"> {INTO_NEXT}</span>
        </>
      )}
    </span>
  );
}
