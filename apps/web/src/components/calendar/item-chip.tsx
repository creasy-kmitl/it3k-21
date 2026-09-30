import { cn } from "@it3k/ui/lib/utils";

import { DEPARTMENT_COLORS, DEPARTMENT_ICONS } from "@/components/department-icon";
import type { CalendarItem } from "@/lib/calendar";
import { STATUS_LABELS } from "@/lib/calendar-labels";

import { ItemContextMenu } from "./calendar-shortcuts";
import { DayRange, describeDayRange } from "./day-range";

/** The department's tint for an item: its colour class, with a fallback. */
export function departmentTint(item: Pick<CalendarItem, "department">) {
  return DEPARTMENT_COLORS[item.department.color] ?? DEPARTMENT_COLORS.slate;
}

/** A compact, clickable item on its department's colour: time, title and department. */
export function ItemChip({
  item,
  day,
  onSelect,
  showTime = true,
  className,
  style,
}: {
  item: CalendarItem;
  /** The Bangkok day the chip sits on; its time is then the part on that day. */
  day?: number;
  onSelect: (item: CalendarItem) => void;
  showTime?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = DEPARTMENT_ICONS[item.department.icon];
  const draft = item.status === "draft";
  return (
    <ItemContextMenu item={item}>
      <button
        type="button"
        onClick={() => onSelect(item)}
        style={style}
        aria-label={`${item.title} ${describeDayRange(item, day)} ${item.department.name}${
          item.collaborators.length > 0
            ? ` ร่วมกับ ${item.collaborators.map((d) => d.name).join(", ")}`
            : ""
        }${draft ? ` (${STATUS_LABELS.draft})` : ""}`}
        className={cn(
          "flex w-full min-w-0 flex-col items-start gap-0.5 overflow-hidden rounded-md border-l-4 border-l-current px-1.5 py-1 text-left text-xs transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          departmentTint(item),
          draft && "border-dashed",
          item.status === "cancelled" && "opacity-60 line-through decoration-foreground/40",
          className,
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-1 text-foreground">
          {showTime && (
            <span className="shrink-0 tabular-nums opacity-80">
              <DayRange range={item} day={day} startOnly />
            </span>
          )}
          <span className="truncate font-medium">{item.title}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1">
          {Icon && <Icon aria-hidden className="size-3 shrink-0" />}
          <span className="truncate">
            {item.department.name}
            {item.collaborators.length > 0 && ` +${item.collaborators.length}`}
          </span>
          {draft && <span className="shrink-0 opacity-80">· {STATUS_LABELS.draft}</span>}
        </span>
      </button>
    </ItemContextMenu>
  );
}
