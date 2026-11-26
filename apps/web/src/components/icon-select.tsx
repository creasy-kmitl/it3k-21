import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { cn } from "@it3k/ui/lib/utils";
import type { ReactNode } from "react";

export type IconSelectItem<T extends string> = {
  value: T | null;
  label: string;
  /** A decorative mark before the label: a lucide icon, a logo or a colour dot. */
  icon?: ReactNode;
};

/**
 * A select whose choices carry an icon, shown in the list and on the trigger.
 * A null value is the "all" or "none" choice. Icons must be decorative
 * (`aria-hidden`, or `alt=""` on images) so each option is named by its label.
 */
export function IconSelect<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  icon,
  className,
  disabled,
}: {
  id?: string;
  /** Names the select for screen readers. */
  label: string;
  items: IconSelectItem<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  /** Shown on the trigger when the chosen item has no icon of its own. */
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next: T | null) => onChange(next ?? null)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} className={cn("w-full", className)}>
        <SelectValue>
          {(current: T | null) => {
            const item = items.find((entry) => entry.value === current);
            return (
              <span className="flex min-w-0 items-center gap-2">
                {item?.icon ?? icon}
                <span className="truncate">{item?.label ?? ""}</span>
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value ?? "none"} value={item.value}>
            {item.icon ?? icon}
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A small round dot in a status colour, for status choices. */
export function StatusDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", className)} />;
}
