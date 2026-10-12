import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@it3k/ui/components/combobox";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useApis } from "@/lib/api-context";
import type { CalendarPerson } from "@/lib/calendar";

/** The API returns at most this many people per search. */
const PAGE_SIZE = 20;

type Owner = Pick<CalendarPerson, "id" | "name"> & { departmentName?: string | null };

/**
 * Picks an owner by searching staff by name on the server, so everyone can
 * be found, not only the first page of names. Clearing it leaves no owner.
 */
export function OwnerPicker({
  id,
  initial,
  onChange,
}: {
  id: string;
  /** The owner already set, shown until someone else is picked. */
  initial: Owner | null;
  onChange: (ownerId: string | null) => void;
}) {
  const { calendar } = useApis();
  const [selected, setSelected] = useState<Owner | null>(initial);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim());
  const people = useQuery({
    queryKey: ["calendar", "people", search],
    queryFn: () => calendar.people(search),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const items: Owner[] = people.data?.items ?? [];

  return (
    <Combobox<Owner>
      items={items}
      value={selected}
      onValueChange={(owner) => {
        setSelected(owner);
        onChange(owner?.id ?? null);
      }}
      onInputValueChange={(value, details) => {
        // Only typing searches; filling the input with a picked name does not.
        if (details.reason === "input-change") setQuery(value);
      }}
      itemToStringLabel={(owner) => owner.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
      // The server has already filtered by name.
      filter={null}
    >
      <ComboboxInput
        id={id}
        placeholder="ค้นหาชื่อ"
        showClear
        triggerLabel="แสดงรายชื่อ"
        clearLabel="ไม่ระบุผู้รับผิดชอบ"
        className="w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty>{people.isFetching ? "กำลังค้นหา" : "ไม่พบรายชื่อ"}</ComboboxEmpty>
        <ComboboxList>
          {(owner: Owner) => (
            <ComboboxItem
              key={owner.id}
              value={owner}
              // Spelled out: the spaced name below would read as "Name(Department)".
              aria-label={
                owner.departmentName ? `${owner.name} (${owner.departmentName})` : owner.name
              }
            >
              <UserRound aria-hidden className="text-muted-foreground" />
              <span className="truncate">
                {owner.name}
                {owner.departmentName && (
                  <span className="text-muted-foreground"> ({owner.departmentName})</span>
                )}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {items.length >= PAGE_SIZE && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            แสดง {PAGE_SIZE} คนแรก พิมพ์ชื่อเพื่อค้นหาคนอื่น
          </p>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
