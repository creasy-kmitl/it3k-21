import { MATCH_STATUSES, MATCH_STATUS_LABELS } from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@it3k/ui/components/input-group";
import type { SportIcon } from "@it3k/db/sport-rules";
import { CalendarDays, MapPin, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { MATCH_STATUS_DOT } from "@/components/competition/match-status-badge";
import { IconSelect, type IconSelectItem, StatusDot } from "@/components/icon-select";
import { SportMark } from "@/components/sport-art";
import { formatBangkok, fromDateKey } from "@/lib/bangkok-time";
import type { FilterOptions, MatchFilters } from "@/lib/public-competition";

const ALL = "all";

type Option = IconSelectItem<string> & { value: string };

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
    <IconSelect
      label={label}
      items={items}
      value={value ?? ALL}
      onChange={(next) => onChange(!next || next === ALL ? undefined : next)}
      className="min-w-0"
    />
  );
}

/** "ศ. 25 ธ.ค." for a `YYYY-MM-DD` day. */
function dayLabel(key: string) {
  const ms = fromDateKey(key);
  return ms === null ? key : formatBangkok(ms, "day");
}

/**
 * Search plus filters for sport, division, day, venue and status. The search
 * waits for typing to pause before it changes the filters (and the URL). The
 * bracket view needs whole rounds, so it offers sport and division only.
 */
export function MatchFiltersBar({
  options,
  value,
  onChange,
  bracket = false,
}: {
  options: FilterOptions | undefined;
  value: MatchFilters;
  onChange: (next: MatchFilters) => void;
  bracket?: boolean;
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
  const divisions = (sport ? [sport] : sports).flatMap((s) => {
    const mark = <SportMark icon={s.icon as SportIcon} seed={s.id} />;
    return s.divisions.map((d) => ({
      value: d.id,
      label: d.name,
      icon: mark,
      group: s.name,
      groupIcon: mark,
      triggerLabel: sport ? d.name : `${s.name} · ${d.name}`,
    }));
  });
  const set = (patch: MatchFilters) => onChange({ ...value, ...patch });
  const active = Object.values(value).some((v) => v !== undefined && v !== "");

  return (
    <div className="flex flex-col gap-2">
      {!bracket && (
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
      )}
      <div className={bracket ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-2 md:grid-cols-5"}>
        <FilterSelect
          label="กีฬา"
          allLabel="ทุกกีฬา"
          options={sports.map((s) => ({
            value: s.id,
            label: s.name,
            icon: <SportMark icon={s.icon as SportIcon} seed={s.id} />,
          }))}
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
        {!bracket && (
          <>
            <FilterSelect
              label="วัน"
              allLabel="ทุกวัน"
              options={(options?.days ?? []).map((day) => ({
                value: day,
                label: dayLabel(day),
                icon: <CalendarDays aria-hidden className="text-muted-foreground" />,
              }))}
              value={value.day}
              onChange={(day) => set({ day })}
            />
            <FilterSelect
              label="สนาม"
              allLabel="ทุกสนาม"
              options={(options?.venues ?? []).map((v) => ({
                value: v.id,
                label: v.name,
                icon: <MapPin aria-hidden className="text-muted-foreground" />,
              }))}
              value={value.venueId}
              onChange={(venueId) => set({ venueId })}
            />
            <FilterSelect
              label="สถานะ"
              allLabel="ทุกสถานะ"
              options={MATCH_STATUSES.map((status) => ({
                value: status,
                label: MATCH_STATUS_LABELS[status],
                icon: <StatusDot className={MATCH_STATUS_DOT[status]} />,
              }))}
              value={value.status}
              onChange={(status) => set({ status: status as MatchFilters["status"] })}
            />
          </>
        )}
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
