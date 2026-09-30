import { CALENDAR_STATUSES, type CalendarStatus } from "@it3k/db/calendar-rules";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@it3k/ui/components/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@it3k/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import {
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Plus,
  Search,
  User,
  UsersRound,
} from "lucide-react";

import { DepartmentLabel } from "@/components/department-icon";
import { OPTION_ICONS, STATUS_ICONS, VIEW_ICONS } from "@/lib/calendar-icons";
import { STATUS_LABELS } from "@/lib/calendar-labels";
import type { LeadershipDepartment } from "@/lib/leadership";

import { IconLabel } from "./icon-label";

export const VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof VIEWS)[number];

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "เดือน",
  week: "สัปดาห์",
  day: "วัน",
  agenda: "รายการ",
};

/**
 * Whose calendars are on screen: the viewer's own department, every
 * department, or a chosen set.
 */
export type DepartmentScope = { kind: "mine" } | { kind: "all" } | { kind: "some"; ids: string[] };

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
  canCreate,
  onCreate,
}: {
  label: string;
  view: CalendarView;
  onView: (view: CalendarView) => void;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
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
  );
}

/** Switches between the viewer's own department, every department, or a chosen set. */
export function DepartmentScopePicker({
  scope,
  onChange,
  departments,
  myDepartmentId,
}: {
  scope: DepartmentScope;
  onChange: (scope: DepartmentScope) => void;
  departments: LeadershipDepartment[];
  myDepartmentId: string | null;
}) {
  const chosen = scope.kind === "some" ? scope.ids : [];
  const toggle = (id: string, checked: boolean) => {
    // Picking starts from what is on screen, so ticking one more adds to it.
    const base =
      scope.kind === "some"
        ? scope.ids
        : scope.kind === "mine" && myDepartmentId
          ? [myDepartmentId]
          : [];
    const ids = checked ? [...new Set([...base, id])] : base.filter((value) => value !== id);
    if (ids.length === 0) onChange(myDepartmentId ? { kind: "mine" } : { kind: "all" });
    else if (ids.length === 1 && ids[0] === myDepartmentId) onChange({ kind: "mine" });
    else onChange({ kind: "some", ids });
  };
  const pickedLabel =
    chosen.length === 1
      ? (departments.find((d) => d.id === chosen[0])?.name ?? "1 แผนก")
      : `${chosen.length} แผนก`;
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0"
      aria-label="แผนกที่แสดง"
    >
      {myDepartmentId && (
        <Toggle pressed={scope.kind === "mine"} onClick={() => onChange({ kind: "mine" })}>
          <User data-icon="inline-start" />
          แผนกของฉัน
        </Toggle>
      )}
      <Toggle pressed={scope.kind === "all"} onClick={() => onChange({ kind: "all" })}>
        <Layers data-icon="inline-start" />
        ทุกแผนก
      </Toggle>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant={scope.kind === "some" ? "default" : "outline"}
              aria-pressed={scope.kind === "some"}
            />
          }
        >
          <UsersRound data-icon="inline-start" />
          {scope.kind === "some" ? pickedLabel : "เลือกแผนก"}
          <ChevronDown data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 w-60 overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuLabel>แสดงปฏิทินของ</DropdownMenuLabel>
            {departments.map((department) => {
              const checked =
                scope.kind === "all" ||
                chosen.includes(department.id) ||
                (scope.kind === "mine" && department.id === myDepartmentId);
              return (
                <DropdownMenuCheckboxItem
                  key={department.id}
                  checked={checked}
                  // Stays open, so several departments can be ticked in one go.
                  closeOnClick={false}
                  onCheckedChange={(next) =>
                    scope.kind === "all"
                      ? onChange({
                          kind: "some",
                          ids: departments.map((d) => d.id).filter((id) => id !== department.id),
                        })
                      : toggle(department.id, next)
                  }
                >
                  <DepartmentLabel department={department} />
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </fieldset>
  );
}

/** Narrowing filters the page keeps in its URL. */
export type CalendarSearchFilters = {
  status?: CalendarStatus;
  mine?: boolean;
};

export function CalendarFilters({
  filters,
  onChange,
  search,
  onSearch,
}: {
  filters: CalendarSearchFilters;
  onChange: (filters: Partial<CalendarSearchFilters>) => void;
  /** The search box's own text; the page debounces it into the URL. */
  search: string;
  onSearch: (text: string) => void;
}) {
  const statusItems = [
    {
      value: ALL,
      label: <IconLabel icon={OPTION_ICONS.all}>สถานะ: ทั้งหมด</IconLabel>,
    },
    ...CALENDAR_STATUSES.map((value) => ({
      value: value as string,
      label: <IconLabel icon={STATUS_ICONS[value]}>{STATUS_LABELS[value]}</IconLabel>,
    })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="w-full sm:w-72">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="ค้นหาชื่อ, สถานที่, ผู้รับผิดชอบ"
          aria-label="ค้นหา"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </InputGroup>
      <Select
        items={statusItems}
        value={filters.status ?? ALL}
        onValueChange={(next: string | null) =>
          onChange({
            status: next === null || next === ALL ? undefined : (next as CalendarStatus),
          })
        }
      >
        <SelectTrigger id="filter-status" aria-label="สถานะ" className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Field orientation="horizontal" className="w-auto">
        <Checkbox
          id="filter-mine"
          checked={filters.mine ?? false}
          onCheckedChange={(checked) => onChange({ mine: checked || undefined })}
        />
        <FieldLabel htmlFor="filter-mine" className="font-normal">
          <User aria-hidden className="size-4 text-muted-foreground" />
          เฉพาะที่ฉันรับผิดชอบ
        </FieldLabel>
      </Field>
    </div>
  );
}
