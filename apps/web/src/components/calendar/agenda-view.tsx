import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@it3k/ui/components/empty";
import { cn } from "@it3k/ui/lib/utils";

import { addDays, formatBangkok, formatRange, sameDay } from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";
import { CATEGORY_LABELS, MODE_LABELS, MODE_STYLES, STATUS_LABELS } from "@/lib/calendar-labels";

import { ItemFlags } from "./item-chip";
import { itemsOnDay } from "./month-view";

/** A list of the days from `start`, skipping days with nothing on them. */
export function AgendaView({
  start,
  days,
  now,
  items,
  onSelect,
}: {
  start: number;
  days: number;
  now: number;
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
}) {
  const groups = Array.from({ length: days }, (_, index) => addDays(start, index))
    .map((day) => ({ day, items: itemsOnDay(items, day) }))
    .filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return (
      <Empty className="rounded-2xl border">
        <EmptyHeader>
          <EmptyTitle>ไม่มีรายการในช่วงนี้</EmptyTitle>
          <EmptyDescription>ลองเปลี่ยนช่วงวันที่หรือล้างตัวกรอง</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.day} aria-label={formatBangkok(group.day, "longDay")}>
          <h2
            className={cn("mb-2 text-sm font-semibold", sameDay(group.day, now) && "text-primary")}
          >
            {formatBangkok(group.day, "longDay")}
            {sameDay(group.day, now) && " · วันนี้"}
          </h2>
          <ul className="divide-y rounded-2xl border">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50",
                    item.status === "cancelled" && "opacity-60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      MODE_STYLES[item.mode].dot,
                    )}
                  />
                  <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatRange(item.startAt, item.endAt)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.title}</span>
                      <ItemFlags item={item} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {MODE_LABELS[item.mode]} · {CATEGORY_LABELS[item.category]} ·{" "}
                      {STATUS_LABELS[item.status]}
                      {item.owner && ` · ${item.owner.name}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
