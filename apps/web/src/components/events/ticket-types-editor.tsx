import {
  MAX_TICKET_TYPES,
  TICKET_ROLES,
  type TicketRole,
  type TicketTypeInput,
} from "@it3k/db/event-rules";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@it3k/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel, FieldSet } from "@it3k/ui/components/field";
import { cn } from "@it3k/ui/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Medal,
  MoreVertical,
  Plus,
  School,
  ShieldCheck,
  Ticket,
  Trash2,
  Type,
  UserCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { FormLegend, TextAreaField, TextField } from "@/components/form-dialog";
import { ROLE_BADGES } from "@/components/role-badge";
import type { Sport } from "@/lib/sports";

/** A ticket type as the editor holds it: numbers as typed, plus what the API reported. */
export type TicketTypeDraft = Omit<TicketTypeInput, "capacity" | "maxPerUser"> & {
  /** Stable across reorders, for React and for the open/closed card state. */
  key: string;
  capacity: string;
  maxPerUser: string;
  /** Tickets already handed out; a type with any cannot be removed. */
  ticketCount: number;
};

export function newTicketTypeDraft(name: string): TicketTypeDraft {
  return {
    key: crypto.randomUUID(),
    name,
    description: "",
    capacity: "",
    maxPerUser: "1",
    open: true,
    listedOnly: false,
    allowedRoles: [],
    allowedInstitutions: [],
    allowedSportIds: [],
    ticketCount: 0,
  };
}

/** The draft as the API takes it; blank capacity is no limit. */
export function ticketTypeInputOf(draft: TicketTypeDraft): TicketTypeInput {
  const { key: _key, ticketCount: _count, capacity, maxPerUser, ...rest } = draft;
  return {
    ...rest,
    capacity: capacity.trim() === "" ? null : Number(capacity),
    maxPerUser: Number(maxPerUser),
  };
}

const toggle = <T,>(list: T[], value: T, on: boolean) =>
  on ? (list.includes(value) ? list : [...list, value]) : list.filter((item) => item !== value);

/** "ทุกคน" or a short list of who may claim, for a collapsed card. */
function audience(draft: TicketTypeDraft, sports: Sport[]) {
  const parts: string[] = [];
  if (draft.listedOnly) parts.push("นักกีฬาในรายชื่อ");
  if (draft.allowedRoles.length > 0) {
    parts.push(draft.allowedRoles.map((role) => ROLE_BADGES[role].label).join("/"));
  }
  if (draft.allowedInstitutions.length > 0) {
    parts.push(
      draft.allowedInstitutions
        .map((id) => INSTITUTIONS.find((item) => item.id === id)?.short ?? id)
        .join("/"),
    );
  }
  if (draft.allowedSportIds.length > 0) {
    parts.push(
      draft.allowedSportIds
        .map((id) => sports.find((sport) => sport.id === id)?.name ?? "กีฬาที่ถูกลบ")
        .join("/"),
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "ทุกคน";
}

/**
 * The event's ticket types, one card each. On phones a card folds to its
 * name and counts; reordering and removing live in each card's menu rather
 * than behind drag handles.
 */
export function TicketTypesEditor({
  value,
  onChange,
  sports,
  sportEvent,
  issues,
  expanded,
  onExpandedChange,
}: {
  value: TicketTypeDraft[];
  onChange: (value: TicketTypeDraft[]) => void;
  sports: Sport[];
  /** Only sport events offer "listed athletes only". */
  sportEvent: boolean;
  /** Messages keyed `ticketTypes.<index>.<field>`, plus `ticketTypes` itself. */
  issues: Record<string, string>;
  expanded: Set<string>;
  onExpandedChange: (expanded: Set<string>) => void;
}) {
  const update = (index: number, patch: Partial<TicketTypeDraft>) =>
    onChange(value.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + by, 0, item);
    onChange(next);
  };
  const setOpen = (key: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(key);
    else next.delete(key);
    onExpandedChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          ยังไม่มีประเภทตั๋ว เพิ่มอย่างน้อย 1 ประเภทเพื่อเปิดรับตั๋ว
        </p>
      )}
      {value.map((draft, index) => {
        const at = (field: string) => issues[`ticketTypes.${index}.${field}`];
        const hasIssue = Object.keys(issues).some((key) => key.startsWith(`ticketTypes.${index}.`));
        const open = expanded.has(draft.key) || hasIssue;
        const id = (field: string) => `ticket-type-${draft.key}-${field}`;
        const capacity = draft.capacity.trim() === "" ? null : Number(draft.capacity);
        return (
          <Collapsible
            key={draft.key}
            open={open}
            onOpenChange={(next) => setOpen(draft.key, next)}
            className={cn(
              "overflow-hidden rounded-2xl border bg-card",
              hasIssue && "border-destructive",
            )}
          >
            <div className="flex items-center gap-1 p-2 pl-3">
              <CollapsibleTrigger
                render={
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                }
              >
                <Ticket className="size-5 shrink-0 text-primary" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{draft.name || "ประเภทตั๋วใหม่"}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    รับแล้ว {draft.ticketCount.toLocaleString("th-TH")}
                    {capacity !== null && Number.isFinite(capacity)
                      ? `/${capacity.toLocaleString("th-TH")}`
                      : ""}{" "}
                    ใบ · {audience(draft, sports)}
                  </span>
                </span>
                <Badge variant={draft.open ? "default" : "outline"} className="shrink-0">
                  {draft.open ? "เปิด" : "ปิด"}
                </Badge>
                <ChevronDown
                  className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
                  aria-hidden
                />
              </CollapsibleTrigger>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 sm:size-9"
                      aria-label={`ตัวเลือกของ ${draft.name || "ประเภทตั๋ว"}`}
                    />
                  }
                >
                  <MoreVertical aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp aria-hidden /> เลื่อนขึ้น
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden /> เลื่อนลง
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={draft.ticketCount > 0}
                    onClick={() => onChange(value.filter((_, at) => at !== index))}
                  >
                    <Trash2 aria-hidden />
                    {draft.ticketCount > 0 ? "มีคนรับแล้ว ลบไม่ได้" : "ลบประเภทนี้"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <CollapsibleContent>
              <div className="flex flex-col gap-5 border-t p-4">
                <TextField
                  id={id("name")}
                  label="ชื่อประเภทตั๋ว"
                  icon={Type}
                  value={draft.name}
                  onChange={(name) => update(index, { name })}
                  error={at("name")}
                  placeholder="เช่น ผู้ชมทั่วไป, VIP, นักกีฬา"
                />
                <TextAreaField
                  id={id("description")}
                  label="คำอธิบาย"
                  value={draft.description}
                  onChange={(description) => update(index, { description })}
                  error={at("description")}
                />
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    id={id("capacity")}
                    label="จำนวนตั๋ว"
                    icon={Users}
                    inputMode="numeric"
                    placeholder="ไม่จำกัด"
                    value={draft.capacity}
                    onChange={(capacity) => update(index, { capacity })}
                    error={at("capacity")}
                  />
                  <TextField
                    id={id("max")}
                    label="สูงสุดต่อคน"
                    icon={UserCheck}
                    inputMode="numeric"
                    value={draft.maxPerUser}
                    onChange={(maxPerUser) => update(index, { maxPerUser })}
                    error={at("maxPerUser")}
                  />
                </div>
                <CheckRow
                  id={id("open")}
                  checked={draft.open}
                  onChange={(checked) => update(index, { open: checked })}
                  label="เปิดรับประเภทนี้"
                  hint="ปิดไว้ก่อนได้ ตั๋วที่รับไปแล้วยังใช้เช็คอินได้"
                />

                <div className="flex flex-col gap-4 rounded-xl bg-muted/50 p-3">
                  <p className="text-sm font-medium">ใครรับได้</p>
                  <p className="-mt-3 text-xs text-muted-foreground">
                    ไม่เลือกหัวข้อไหน = ทุกคนรับได้ ถ้าเลือกหลายหัวข้อ ต้องผ่านทุกหัวข้อ
                  </p>
                  {sportEvent ? (
                    <CheckRow
                      id={id("listed")}
                      checked={draft.listedOnly}
                      onChange={(checked) => update(index, { listedOnly: checked })}
                      label="เฉพาะนักกีฬาในรายชื่อกิจกรรมนี้"
                      hint="นักกีฬาที่อนุมัติแล้ว ในประเภทกีฬาและสถาบันของกิจกรรม"
                      error={at("listedOnly")}
                    />
                  ) : (
                    draft.listedOnly && (
                      <FieldError>{at("listedOnly") ?? "ใช้ได้เฉพาะกิจกรรมกีฬา"}</FieldError>
                    )
                  )}
                  <ChoiceGroup
                    legend="บทบาท"
                    icon={ShieldCheck}
                    error={at("allowedRoles")}
                  >
                    {TICKET_ROLES.map((role: TicketRole) => (
                      <CheckRow
                        key={role}
                        id={id(`role-${role}`)}
                        checked={draft.allowedRoles.includes(role)}
                        onChange={(checked) =>
                          update(index, { allowedRoles: toggle(draft.allowedRoles, role, checked) })
                        }
                        label={ROLE_BADGES[role].label}
                      />
                    ))}
                  </ChoiceGroup>
                  <ChoiceGroup legend="สถาบัน" icon={School} error={at("allowedInstitutions")}>
                    {INSTITUTIONS.map((institution) => (
                      <CheckRow
                        key={institution.id}
                        id={id(`inst-${institution.id}`)}
                        checked={draft.allowedInstitutions.includes(institution.id)}
                        onChange={(checked) =>
                          update(index, {
                            allowedInstitutions: toggle<Institution>(
                              draft.allowedInstitutions,
                              institution.id,
                              checked,
                            ),
                          })
                        }
                        label={institution.short}
                      />
                    ))}
                  </ChoiceGroup>
                  <ChoiceGroup
                    legend="นักกีฬาของกีฬา"
                    icon={Medal}
                    error={at("allowedSportIds")}
                    hint="ผู้ที่สมัครกีฬานั้นและได้รับอนุมัติแล้ว"
                  >
                    {sports.map((sport) => (
                      <CheckRow
                        key={sport.id}
                        id={id(`sport-${sport.id}`)}
                        checked={draft.allowedSportIds.includes(sport.id)}
                        onChange={(checked) =>
                          update(index, {
                            allowedSportIds: toggle(draft.allowedSportIds, sport.id, checked),
                          })
                        }
                        label={sport.name}
                      />
                    ))}
                  </ChoiceGroup>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      <FieldError>{issues.ticketTypes}</FieldError>
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:h-9 sm:self-start"
        disabled={value.length >= MAX_TICKET_TYPES}
        onClick={() => {
          const draft = newTicketTypeDraft(value.length === 0 ? "ทั่วไป" : "");
          onChange([...value, draft]);
          setOpen(draft.key, true);
        }}
      >
        <Plus data-icon="inline-start" aria-hidden /> เพิ่มประเภทตั๋ว
      </Button>
    </div>
  );
}

function CheckRow({
  id,
  checked,
  onChange,
  label,
  hint,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <Field orientation="horizontal" data-invalid={!!error} className="min-h-11 items-start sm:min-h-0">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-0.5"
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
        <FieldError>{error}</FieldError>
      </div>
    </Field>
  );
}

function ChoiceGroup({
  legend,
  icon,
  hint,
  error,
  children,
}: {
  legend: string;
  icon: typeof School;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <FieldSet data-invalid={!!error} className="gap-2">
      <FormLegend icon={icon}>{legend}</FormLegend>
      {hint && <FieldDescription className="-mt-1 text-xs">{hint}</FieldDescription>}
      <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">{children}</div>
      <FieldError>{error}</FieldError>
    </FieldSet>
  );
}
