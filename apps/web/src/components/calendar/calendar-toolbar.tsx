import {
  CALENDAR_CATEGORIES,
  CALENDAR_MODES,
  CALENDAR_STATUSES,
  CATEGORIES_BY_MODE,
  type CalendarCategory,
  type CalendarMode,
  type CalendarStatus,
  GAMES,
  type Game,
} from "@it3k/db/calendar-rules";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@it3k/ui/components/collapsible";
import { Field, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@it3k/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { cn } from "@it3k/ui/lib/utils";
import {
  Archive,
  CalendarCheck,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Plus,
  Radio,
  Rocket,
  Search,
  SlidersHorizontal,
  User,
} from "lucide-react";

import { MODE_ICONS, VIEW_ICONS } from "@/lib/calendar-icons";
import {
  CATEGORY_LABELS,
  GAME_LABELS,
  MODE_LABELS,
  MODE_STYLES,
  STATUS_LABELS,
} from "@/lib/calendar-labels";

export const VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof VIEWS)[number];

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "เดือน",
  week: "สัปดาห์",
  day: "วัน",
  agenda: "รายการ",
};

/** Filters the page keeps in its URL. */
export type CalendarSearchFilters = {
  modes?: CalendarMode[];
  category?: CalendarCategory;
  status?: CalendarStatus;
  game?: Game;
  departmentId?: string;
  mine?: boolean;
  archived?: boolean;
  q?: string;
  venue?: string;
  streamPlatform?: string;
  environment?: string;
};

const ALL = "__all__";

function Toggle({
  pressed,
  onClick,
  children,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? "default" : "outline"}
      aria-pressed={pressed}
      onClick={onClick}
      className={className}
    >
      {children}
    </Button>
  );
}

export function CalendarToolbar({
  label,
  view,
  onView,
  onPrevious,
  onToday,
  onNext,
  onJump,
  canCreate,
  onCreate,
}: {
  label: string;
  view: CalendarView;
  onView: (view: CalendarView) => void;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  onJump: (target: "week" | "live" | "release") => void;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={onPrevious} aria-label="ก่อนหน้า">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={onToday}>
            <CalendarCheck data-icon="inline-start" />
            วันนี้
          </Button>
          <Button variant="outline" size="icon-sm" onClick={onNext} aria-label="ถัดไป">
            <ChevronRight />
          </Button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold" aria-live="polite">
          {label}
        </h2>
        <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0" aria-label="มุมมอง">
          {VIEWS.map((option) => {
            const Icon = VIEW_ICONS[option];
            return (
              <Toggle key={option} pressed={view === option} onClick={() => onView(option)}>
                <Icon data-icon="inline-start" />
                {VIEW_LABELS[option]}
              </Toggle>
            );
          })}
        </fieldset>
        {canCreate && (
          <Button size="sm" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            เพิ่มรายการ
          </Button>
        )}
      </div>
      <fieldset
        className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
        aria-label="ไปที่"
      >
        <Button variant="ghost" size="sm" onClick={() => onJump("week")}>
          <CalendarRange data-icon="inline-start" />
          สัปดาห์นี้
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onJump("live")}>
          <Radio data-icon="inline-start" />
          Live ถัดไป
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onJump("release")}>
          <Rocket data-icon="inline-start" />
          Release ถัดไป
        </Button>
      </fieldset>
    </div>
  );
}

function FilterSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
}) {
  const items = [{ value: ALL, label: `${label}: ทั้งหมด` }, ...options];
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(next: string | null) =>
        onChange(next === null || next === ALL ? undefined : (next as T))
      }
    >
      <SelectTrigger id={id} aria-label={label} className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CalendarFilters({
  filters,
  onChange,
  search,
  onSearch,
  departments,
}: {
  filters: CalendarSearchFilters;
  onChange: (filters: Partial<CalendarSearchFilters>) => void;
  /** The search box's own text; the page debounces it into `filters.q`. */
  search: string;
  onSearch: (text: string) => void;
  departments: { id: string; name: string }[];
}) {
  const modes = filters.modes ?? [];
  const toggleMode = (mode: CalendarMode) => {
    const next = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode];
    // A category from a mode that is no longer shown would hide everything.
    const categories = next.length ? next.flatMap((m) => CATEGORIES_BY_MODE[m]) : null;
    onChange({
      modes: next.length ? next : undefined,
      ...(filters.category && categories && !categories.includes(filters.category)
        ? { category: undefined }
        : {}),
    });
  };
  const categories = modes.length
    ? CALENDAR_CATEGORIES.filter((c) => modes.some((m) => CATEGORIES_BY_MODE[m].includes(c)))
    : CALENDAR_CATEGORIES;
  const extraCount = [filters.venue, filters.streamPlatform, filters.environment].filter(
    Boolean,
  ).length;

  return (
    <div className="flex flex-col gap-2">
      <fieldset
        className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
        aria-label="โหมด"
      >
        <Toggle pressed={modes.length === 0} onClick={() => onChange({ modes: undefined })}>
          <LayoutGrid data-icon="inline-start" />
          ทั้งหมด
        </Toggle>
        {CALENDAR_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode];
          const pressed = modes.includes(mode);
          return (
            <Toggle key={mode} pressed={pressed} onClick={() => toggleMode(mode)}>
              <Icon data-icon="inline-start" className={cn(!pressed && MODE_STYLES[mode].icon)} />
              {MODE_LABELS[mode]}
            </Toggle>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="ค้นหาชื่อ, Match ID, ทีม, ฟีเจอร์, ผู้รับผิดชอบ"
            aria-label="ค้นหา"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </InputGroup>
        <FilterSelect
          id="filter-category"
          label="ประเภท"
          value={filters.category}
          options={categories.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
          onChange={(category) => onChange({ category })}
        />
        <FilterSelect
          id="filter-status"
          label="สถานะ"
          value={filters.status}
          options={CALENDAR_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
          onChange={(status) => onChange({ status })}
        />
        <FilterSelect
          id="filter-game"
          label="เกม"
          value={filters.game}
          options={GAMES.map((value) => ({ value, label: GAME_LABELS[value] }))}
          onChange={(game) => onChange({ game })}
        />
        <FilterSelect
          id="filter-department"
          label="ฝ่าย"
          value={filters.departmentId}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
          onChange={(departmentId) => onChange({ departmentId })}
        />
      </div>
      <Collapsible defaultOpen={extraCount > 0}>
        <div className="flex flex-wrap items-center gap-4">
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="filter-mine"
              checked={filters.mine ?? false}
              onCheckedChange={(checked) => onChange({ mine: checked || undefined })}
            />
            <FieldLabel htmlFor="filter-mine" className="font-normal">
              <User aria-hidden className="size-4 text-muted-foreground" />
              เฉพาะงานของฉัน
            </FieldLabel>
          </Field>
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="filter-archived"
              checked={filters.archived ?? false}
              onCheckedChange={(checked) => onChange({ archived: checked || undefined })}
            />
            <FieldLabel htmlFor="filter-archived" className="font-normal">
              <Archive aria-hidden className="size-4 text-muted-foreground" />
              แสดงที่เก็บถาวร
            </FieldLabel>
          </Field>
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
            <SlidersHorizontal data-icon="inline-start" />
            ตัวกรองเพิ่มเติม{extraCount > 0 && ` (${extraCount})`}
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex flex-wrap gap-2 pt-2">
          <Input
            aria-label="สถานที่"
            placeholder="สถานที่"
            value={filters.venue ?? ""}
            onChange={(e) => onChange({ venue: e.target.value || undefined })}
            className="w-full sm:w-44"
          />
          <Input
            aria-label="แพลตฟอร์มสตรีม"
            placeholder="แพลตฟอร์มสตรีม"
            value={filters.streamPlatform ?? ""}
            onChange={(e) => onChange({ streamPlatform: e.target.value || undefined })}
            className="w-full sm:w-44"
          />
          <Input
            aria-label="Environment"
            placeholder="Release environment"
            value={filters.environment ?? ""}
            onChange={(e) => onChange({ environment: e.target.value || undefined })}
            className="w-full sm:w-44"
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
