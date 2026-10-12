import { cn } from "@it3k/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

export type Segment<T> = { value: T; label: string; icon?: LucideIcon };

/**
 * A few mutually exclusive choices on one pill track, the same height and
 * shape as an input, with the chosen one raised on it.
 */
export function SegmentedControl<T extends string | number | boolean>({
  label,
  segments,
  value,
  onChange,
  className,
}: {
  /** Names the group for screen readers. */
  label: string;
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className={cn(
        "m-0 flex h-9 shrink-0 items-center gap-0.5 rounded-4xl border-0 bg-muted p-1",
        className,
      )}
    >
      {segments.map((segment) => {
        const pressed = segment.value === value;
        return (
          <button
            key={String(segment.value)}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(segment.value)}
            className={cn(
              "flex h-full items-center gap-1.5 rounded-4xl px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
              pressed && "bg-background text-foreground ring-1 ring-border",
            )}
          >
            {segment.icon && <segment.icon aria-hidden />}
            {segment.label}
          </button>
        );
      })}
    </fieldset>
  );
}
