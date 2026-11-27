import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSelectTrigger,
  ComboboxValue,
} from "@it3k/ui/components/combobox";
import { InputGroupAddon } from "@it3k/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { cn } from "@it3k/ui/lib/utils";
import { Search } from "lucide-react";
import type { ReactNode } from "react";

export type IconSelectItem<T extends string> = {
  value: T | null;
  label: string;
  /** A decorative mark before the label: a lucide icon, a logo or a colour dot. */
  icon?: ReactNode;
  /** The heading this item is listed under. Items without one come first, unheaded. */
  group?: string;
  /** A decorative mark before the group's heading, taken from its first item that has one. */
  groupIcon?: ReactNode;
  /**
   * Replaces the icon and label in the list, and on the trigger unless there is a
   * `triggerLabel`, e.g. a coloured tag; the label still names and finds it.
   */
  content?: ReactNode;
  /** What the closed select shows when this item is picked, if not its label. */
  triggerLabel?: string;
  disabled?: boolean;
};

type Group<T extends string> = {
  value: string;
  icon?: ReactNode;
  items: IconSelectItem<T>[];
};

/** More choices than this get a search box. */
export const SEARCH_THRESHOLD = 7;

/** Groups in the order their first item appears; the unheaded items first. */
export function groupItems<T extends string>(items: IconSelectItem<T>[]): Group<T>[] {
  const groups = new Map<string, Group<T>>([["", { value: "", items: [] }]]);
  for (const item of items) {
    const key = item.group ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { value: key, items: [] };
      groups.set(key, group);
    }
    group.icon ??= item.groupIcon;
    group.items.push(item);
  }
  return [...groups.values()].filter((group) => group.items.length > 0);
}

/** Whether an item matches what was typed: its label, its group or its trigger label. */
export function matchesQuery(item: IconSelectItem<string>, query: string) {
  const needle = query.trim().toLocaleLowerCase("th");
  if (!needle) return true;
  // Thai has no spaces between words, so match anywhere rather than by word.
  return [item.label, item.group, item.triggerLabel].some((text) =>
    text?.toLocaleLowerCase("th").includes(needle),
  );
}

function Shown({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

function GroupHeading({ group }: { group: Group<string> }) {
  return (
    <span className="flex items-center gap-2">
      {group.icon}
      {group.value}
    </span>
  );
}

/**
 * The app's select: choices with an icon, listed under group headings, with a
 * search box once there are more than {@link SEARCH_THRESHOLD} of them. Typing
 * a group's name finds every choice under it. A null value is the "all" or
 * "none" choice. Icons must be decorative (`aria-hidden`, or `alt=""` on
 * images) so each option is named by its label.
 */
export function IconSelect<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  icon,
  placeholder,
  searchable = items.length > SEARCH_THRESHOLD,
  searchPlaceholder = "ค้นหา",
  emptyLabel = "ไม่พบตัวเลือก",
  invalid,
  required,
  describedBy,
  onBlur,
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
  /** Shown when nothing is picked and there is no null item. */
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when nothing matches the search. */
  emptyLabel?: string;
  invalid?: boolean;
  required?: boolean;
  /** The id of text that explains the field, read after its name. */
  describedBy?: string;
  onBlur?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const groups = groupItems(items);
  const selected = items.find((item) => item.value === value) ?? null;
  const trigger = (item: IconSelectItem<T> | null) =>
    item?.content && !item.triggerLabel ? (
      <span className="flex min-w-0 items-center">{item.content}</span>
    ) : item ? (
      <Shown icon={item.icon ?? icon}>{item.triggerLabel ?? item.label}</Shown>
    ) : (
      <Shown icon={icon}>
        <span className="text-muted-foreground">{placeholder ?? ""}</span>
      </Shown>
    );

  if (searchable) {
    return (
      <Combobox<IconSelectItem<T>>
        items={groups}
        value={selected}
        onValueChange={(item) => item && onChange(item.value)}
        itemToStringLabel={(item) => item.triggerLabel ?? item.label}
        isItemEqualToValue={(a, b) => a.value === b.value}
        filter={(item, query) => matchesQuery(item, query)}
        disabled={disabled}
      >
        <ComboboxSelectTrigger
          id={id}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          onBlur={onBlur}
          className={cn("w-full", className)}
        >
          <ComboboxValue>{(item: IconSelectItem<T> | null) => trigger(item)}</ComboboxValue>
        </ComboboxSelectTrigger>
        <ComboboxContent className="min-w-(--anchor-width)">
          <ComboboxInput
            aria-label={`ค้นหา${label}`}
            placeholder={searchPlaceholder}
            showTrigger={false}
            className="w-auto"
          >
            <InputGroupAddon align="inline-start">
              <Search aria-hidden />
            </InputGroupAddon>
          </ComboboxInput>
          <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
          <ComboboxList>
            {(group: Group<T>) => (
              <ComboboxGroup key={group.value} items={group.items}>
                {group.value && (
                  <ComboboxLabel>
                    <GroupHeading group={group} />
                  </ComboboxLabel>
                )}
                <ComboboxCollection>
                  {(item: IconSelectItem<T>) => (
                    <ComboboxItem key={item.value ?? "none"} value={item} disabled={item.disabled}>
                      {item.content ?? (
                        <>
                          {item.icon ?? icon}
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    );
  }

  return (
    <Select
      items={items.map((item) => ({ value: item.value, label: item.triggerLabel ?? item.label }))}
      value={value}
      onValueChange={(next: T | null) => onChange(next ?? null)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        onBlur={onBlur}
        className={cn("w-full", className)}
      >
        <SelectValue>
          {(current: T | null) => trigger(items.find((entry) => entry.value === current) ?? null)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.value}>
            {group.value && (
              <SelectLabel>
                <GroupHeading group={group} />
              </SelectLabel>
            )}
            {group.items.map((item) => (
              <SelectItem key={item.value ?? "none"} value={item.value} disabled={item.disabled}>
                {item.content ?? (
                  <>
                    {item.icon ?? icon}
                    {item.label}
                  </>
                )}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A small round dot in a status colour, for status choices. */
export function StatusDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", className)} />;
}
