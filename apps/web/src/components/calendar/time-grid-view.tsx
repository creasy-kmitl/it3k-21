import { cn } from "@it3k/ui/lib/utils";
import { useEffect, useRef } from "react";

import { DAY_MS, HOUR_MS, addDays, formatBangkok, sameDay } from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";

import { ItemChip } from "./item-chip";
import { itemsOnDay } from "./month-view";

const HOUR_PX = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** Scrolled into view first: event days rarely start before this. */
const FIRST_VISIBLE_HOUR = 7;
const MIN_HEIGHT_PX = 22;

type Placed = { item: CalendarItem; top: number; height: number; lane: number; lanes: number };

/**
 * Lays one day's items out side by side where they overlap. Each group of
 * overlapping items shares its width between as many lanes as it needs.
 */
export function layoutDay(items: CalendarItem[], day: number): Placed[] {
  const sorted = [...items].sort((a, b) => a.startAt - b.startAt || b.endAt - a.endAt);
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;
  const closeGroup = () => {
    const lanes = Math.max(1, ...group.map((entry) => entry.lane + 1));
    for (const entry of group) entry.lanes = lanes;
    group = [];
  };
  for (const item of sorted) {
    const start = Math.max(item.startAt, day);
    const end = Math.min(item.endAt, day + DAY_MS);
    if (start >= groupEnd) closeGroup();
    const laneEnds = new Map<number, number>();
    for (const entry of group) {
      const entryEnd = Math.min(entry.item.endAt, day + DAY_MS);
      laneEnds.set(entry.lane, Math.max(laneEnds.get(entry.lane) ?? 0, entryEnd));
    }
    let lane = 0;
    while ((laneEnds.get(lane) ?? Number.NEGATIVE_INFINITY) > start) lane++;
    const entry: Placed = {
      item,
      top: ((start - day) / HOUR_MS) * HOUR_PX,
      height: Math.max(MIN_HEIGHT_PX, ((end - start) / HOUR_MS) * HOUR_PX),
      lane,
      lanes: 1,
    };
    group.push(entry);
    placed.push(entry);
    groupEnd = Math.max(groupEnd, end);
  }
  closeGroup();
  return placed;
}

/** Week (7 days) or day (1 day) columns on a 24-hour grid, with a line at now. */
export function TimeGridView({
  start,
  days,
  now,
  items,
  onSelect,
  onOpenDay,
}: {
  start: number;
  days: number;
  now: number;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  onOpenDay: (day: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = Array.from({ length: days }, (_, index) => addDays(start, index));

  useEffect(() => {
    scroller.current?.scrollTo?.({ top: FIRST_VISIBLE_HOUR * HOUR_PX });
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border">
      <div className="flex border-b bg-muted/40 text-xs">
        <div className="w-12 shrink-0" />
        {columns.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => onOpenDay(day)}
            className={cn(
              "min-w-0 flex-1 border-l py-2 text-center hover:bg-muted",
              sameDay(day, now) && "font-semibold text-primary",
            )}
          >
            {formatBangkok(day, "day")}
          </button>
        ))}
      </div>
      <div ref={scroller} className="max-h-[70vh] overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">
            {HOURS.map((hour) => (
              <div key={hour} className="pr-1" style={{ height: HOUR_PX }}>
                {hour > 0 && `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {columns.map((day) => (
            <div key={day} className="relative min-w-0 flex-1 border-l">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="border-b border-dashed border-border/60"
                  style={{ height: HOUR_PX }}
                />
              ))}
              <ul className="absolute inset-0" aria-label={formatBangkok(day, "longDay")}>
                {layoutDay(itemsOnDay(items, day), day).map((entry) => (
                  <li
                    key={entry.item.id}
                    className="absolute px-0.5"
                    style={{
                      top: entry.top,
                      height: entry.height,
                      left: `${(entry.lane / entry.lanes) * 100}%`,
                      width: `${100 / entry.lanes}%`,
                    }}
                  >
                    <ItemChip item={entry.item} onSelect={onSelect} className="h-full" />
                  </li>
                ))}
              </ul>
              {sameDay(day, now) && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                  style={{ top: ((now - day) / HOUR_MS) * HOUR_PX }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
