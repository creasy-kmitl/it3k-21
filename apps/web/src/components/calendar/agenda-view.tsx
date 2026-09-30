import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@it3k/ui/components/empty";
import { cn } from "@it3k/ui/lib/utils";

import { addDays, formatBangkok, formatRange, sameDay } from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";
import { STATUS_LABELS } from "@/lib/calendar-labels";
import { DepartmentIcon } from "@/components/department-icon";

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
                  <DepartmentIcon department={item.department} className="size-7" />
                  <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatRange(item.startAt, item.endAt)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={cn(
                        "font-medium",
                        item.status === "cancelled" && "line-through decoration-foreground/40",
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.department.name} · {STATUS_LABELS[item.status]}
                      {item.venue && ` · ${item.venue}`}
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
