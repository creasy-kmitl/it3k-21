import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { cn } from "@it3k/ui/lib/utils";

export type MatchSelectItem<T extends string> = { value: T | null; label: string };

/** A select over plain labels; a null value is the "all" or "none" choice. */
export function MatchSelect<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  className,
  disabled,
}: {
  id?: string;
  /** Names the select for screen readers. */
  label: string;
  items: MatchSelectItem<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
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
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value ?? "none"} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
