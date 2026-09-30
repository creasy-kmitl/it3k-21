import { cn } from "@it3k/ui/lib/utils";

import { formatBangkok, formatRange } from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";
import { CATEGORY_ICONS, FLAG_ICONS } from "@/lib/calendar-icons";
import { CATEGORY_LABELS, MODE_STYLES, itemFlags } from "@/lib/calendar-labels";

export function ItemFlags({ item, className }: { item: CalendarItem; className?: string }) {
  const flags = itemFlags(item);
  if (flags.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {flags.map((flag) => {
        const Icon = FLAG_ICONS[flag.key];
        return (
          <span
            key={flag.key}
            className={cn(
              "inline-flex h-4 items-center gap-0.5 rounded-full px-1.5 text-[10px] leading-none font-semibold",
              flag.className,
            )}
          >
            {Icon && <Icon aria-hidden className="size-2.5 shrink-0" />}
            {flag.label}
          </span>
        );
      })}
    </span>
  );
}

/** A compact, clickable item: mode colour, time, title and warning badges. */
export function ItemChip({
  item,
  onSelect,
  showTime = true,
  className,
  style,
}: {
  item: CalendarItem;
  onSelect: (item: CalendarItem) => void;
  showTime?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const muted = item.status === "cancelled" || item.archivedAt !== null;
  const Icon = CATEGORY_ICONS[item.category];
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      style={style}
      aria-label={`${item.title} ${formatRange(item.startAt, item.endAt)}`}
      className={cn(
        "flex w-full min-w-0 flex-col items-start gap-0.5 overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-xs transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        MODE_STYLES[item.mode].chip,
        item.tbd && "border-dashed",
        muted && "opacity-60 line-through decoration-foreground/40",
        className,
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-1">
        {showTime && (
          <span className="shrink-0 tabular-nums opacity-80">
            {formatBangkok(item.startAt, "time")}
          </span>
        )}
        <Icon aria-hidden className="size-3 shrink-0 opacity-80" />
        <span className="truncate font-medium">{item.title}</span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1">
        <span className="truncate opacity-70">{CATEGORY_LABELS[item.category]}</span>
        <ItemFlags item={item} />
      </span>
    </button>
  );
}
