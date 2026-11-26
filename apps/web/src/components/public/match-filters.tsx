import { MATCH_STATUSES, MATCH_STATUS_LABELS } from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@it3k/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatBangkok, fromDateKey } from "@/lib/bangkok-time";
import type { FilterOptions, MatchFilters } from "@/lib/public-competition";

const ALL = "all";

type Option = { value: string; label: string };

function FilterSelect({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: Option[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const items = [{ value: ALL, label: allLabel }, ...options];
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(next: string | null) => onChange(!next || next === ALL ? undefined : next)}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** "ศ. 25 ธ.ค." for a `YYYY-MM-DD` day. */
function dayLabel(key: string) {
  const ms = fromDateKey(key);
  return ms === null ? key : formatBangkok(ms, "day");
}

/**
 * Search plus filters for sport, division, day, venue and status. The search
 * waits for typing to pause before it changes the filters (and the URL).
 */
export function MatchFiltersBar({
  options,
  value,
  onChange,
}: {
  options: FilterOptions | undefined;
  value: MatchFilters;
  onChange: (next: MatchFilters) => void;
}) {
  const [text, setText] = useState(value.q ?? "");
  useEffect(() => setText(value.q ?? ""), [value.q]);
  useEffect(() => {
    if (text === (value.q ?? "")) return;
    const timer = setTimeout(() => onChange({ ...value, q: text || undefined }), 300);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  const sports = options?.sports ?? [];
  const sport = sports.find((s) => s.id === value.sportId);
  const divisions = (sport ? [sport] : sports).flatMap((s) =>
    s.divisions.map((d) => ({ value: d.id, label: d.name })),
  );
  const set = (patch: MatchFilters) => onChange({ ...value, ...patch });
  const active = Object.values(value).some((v) => v !== undefined && v !== "");

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="ค้นหาสถาบัน กีฬา หรือสนาม"
          aria-label="ค้นหาแมตช์"
        />
      </InputGroup>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <FilterSelect
          label="กีฬา"
          allLabel="ทุกกีฬา"
          options={sports.map((s) => ({ value: s.id, label: s.name }))}
          value={value.sportId}
          onChange={(sportId) => set({ sportId, divisionId: undefined })}
        />
        <FilterSelect
          label="ประเภท"
          allLabel="ทุกประเภท"
          options={divisions}
          value={value.divisionId}
          onChange={(divisionId) => set({ divisionId })}
        />
        <FilterSelect
          label="วัน"
          allLabel="ทุกวัน"
          options={(options?.days ?? []).map((day) => ({ value: day, label: dayLabel(day) }))}
          value={value.day}
          onChange={(day) => set({ day })}
        />
        <FilterSelect
          label="สนาม"
          allLabel="ทุกสนาม"
          options={(options?.venues ?? []).map((v) => ({ value: v.id, label: v.name }))}
          value={value.venueId}
          onChange={(venueId) => set({ venueId })}
        />
        <FilterSelect
          label="สถานะ"
          allLabel="ทุกสถานะ"
          options={MATCH_STATUSES.map((status) => ({
            value: status,
            label: MATCH_STATUS_LABELS[status],
          }))}
          value={value.status}
          onChange={(status) => set({ status: status as MatchFilters["status"] })}
        />
      </div>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setText("");
            onChange({});
          }}
        >
          <X data-icon="inline-start" aria-hidden />
          ล้างตัวกรอง
        </Button>
      )}
    </div>
  );
}
