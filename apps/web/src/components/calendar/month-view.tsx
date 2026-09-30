import { cn } from "@it3k/ui/lib/utils";

import {
  DAY_MS,
  bangkokParts,
  formatBangkok,
  monthGrid,
  sameDay,
  startOfDay,
} from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";

import { SlotContextMenu } from "./calendar-shortcuts";
import { ItemChip } from "./item-chip";

const VISIBLE_PER_DAY = 3;

/** Items that touch the Bangkok day starting at `day`. */
export function itemsOnDay(items: CalendarItem[], day: number) {
  return items.filter((item) => item.startAt < day + DAY_MS && item.endAt > day);
}

export function MonthView({
  date,
  now,
  items,
  onSelect,
  onOpenDay,
}: {
  date: number;
  now: number;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
  onOpenDay: (day: number) => void;
}) {
  const weeks = monthGrid(date);
  const month = bangkokParts(date).month;
  const weekdays = weeks[0] ?? [];

  return (
    <section className="overflow-hidden rounded-2xl border" aria-label="ปฏิทินรายเดือน">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs text-muted-foreground">
        {weekdays.map((day) => (
          <div key={day} className="py-2">
            {formatBangkok(day, "weekday")}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((day) => {
            const dayItems = itemsOnDay(items, day);
            const outside = bangkokParts(day).month !== month;
            const today = sameDay(day, now);
            return (
              <SlotContextMenu key={day} day={startOfDay(day)}>
                <div
                  className={cn(
                    "flex min-h-28 min-w-0 flex-col gap-1 border-r p-1 last:border-r-0",
                    outside && "bg-muted/30",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpenDay(startOfDay(day))}
                    aria-label={formatBangkok(day, "longDay")}
                    className={cn(
                      "flex size-6 items-center justify-center self-end rounded-full text-xs tabular-nums hover:bg-muted",
                      outside && "text-muted-foreground",
                      today && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {bangkokParts(day).day}
                  </button>
                  {dayItems.slice(0, VISIBLE_PER_DAY).map((item) => (
                    <ItemChip key={item.id} item={item} onSelect={onSelect} />
                  ))}
                  {dayItems.length > VISIBLE_PER_DAY && (
                    <button
                      type="button"
                      onClick={() => onOpenDay(startOfDay(day))}
                      className="text-left text-xs text-muted-foreground hover:underline"
                    >
                      +{dayItems.length - VISIBLE_PER_DAY} รายการ
                    </button>
                  )}
                </div>
              </SlotContextMenu>
            );
          })}
        </div>
      ))}
    </section>
  );
}
