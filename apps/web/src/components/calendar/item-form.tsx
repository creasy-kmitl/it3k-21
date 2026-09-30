import {
  CALENDAR_MODES,
  CATEGORIES_BY_MODE,
  type CalendarCategory,
  type CalendarMode,
  type CalendarStatus,
  GAMES,
  RISK_LEVELS,
  statusesFor,
} from "@it3k/db/calendar-rules";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Spinner } from "@it3k/ui/components/spinner";
import { Textarea } from "@it3k/ui/components/textarea";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { useApis } from "@/lib/api-context";
import { HOUR_MS, fromDatetimeLocal, toDatetimeLocal } from "@/lib/bangkok-time";
import type { CalendarInput, CalendarItem, CalendarItemDetail } from "@/lib/calendar";
import {
  CATEGORY_LABELS,
  GAME_LABELS,
  MODE_LABELS,
  RISK_LABELS,
  STATUS_LABELS,
  VISIBILITY_LABELS,
} from "@/lib/calendar-labels";
import { ApiError } from "@/lib/leadership";

export type ItemFormMode =
  | { kind: "create"; start: number }
  | { kind: "edit"; item: CalendarItemDetail };

const NONE = "__none__";

const https = z
  .string()
  .trim()
  .max(500, "ยาวเกิน 500 ตัวอักษร")
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "ลิงก์ต้องขึ้นต้นด้วย https://");

const text = (max: number) => z.string().trim().max(max, `ยาวเกิน ${max} ตัวอักษร`);

// Mirrors the server's rules so mistakes show up before a round trip; the
// server still validates everything.
const fields = z.object({
  title: text(200).min(1, "กรุณาใส่ชื่อรายการ"),
  mode: z.enum(CALENDAR_MODES),
  category: z.string(),
  status: z.string(),
  start: z.string().refine((value) => fromDatetimeLocal(value) !== null, "กรุณาใส่เวลาเริ่ม"),
  end: z.string().refine((value) => fromDatetimeLocal(value) !== null, "กรุณาใส่เวลาสิ้นสุด"),
  ownerId: z.string().min(1, "กรุณาเลือกผู้รับผิดชอบ"),
  source: text(200).min(1, "กรุณาระบุแหล่งข้อมูล"),
  departmentIds: z.array(z.string()),
  riskLevel: z.string(),
  blockedReason: text(500),
  visibility: z.enum(["internal", "public"]),
  confirm: z.boolean(),
  game: z.string(),
  matchId: text(64),
  teams: text(1000),
  venue: text(120),
  streamPlatform: text(64),
  scoreboardUrl: https,
  meetingLink: https,
  agenda: text(4000),
  feature: text(200),
  environment: text(64),
  notes: text(4000),
  reason: text(500),
});

type FormValues = z.input<typeof fields>;

/** Moving an item or cancelling it must say why; the change log keeps the reason. */
function needsReason(values: FormValues, original: CalendarItemDetail | null) {
  return (
    original !== null &&
    (fromDatetimeLocal(values.start) !== original.startAt ||
      fromDatetimeLocal(values.end) !== original.endAt ||
      (values.status === "cancelled" && original.status !== "cancelled"))
  );
}

function formSchema(original: CalendarItemDetail | null) {
  return fields.superRefine((values, ctx) => {
    const start = fromDatetimeLocal(values.start);
    const end = fromDatetimeLocal(values.end);
    if (start !== null && end !== null && end <= start) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "เวลาสิ้นสุดต้องหลังเวลาเริ่ม" });
    }
    if (needsReason(values, original) && !values.reason.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "กรุณาบอกเหตุผลที่เลื่อนหรือยกเลิก",
      });
    }
  });
}

function defaults(mode: ItemFormMode, ownerId: string): FormValues {
  const item = mode.kind === "edit" ? mode.item : null;
  const start = item?.startAt ?? (mode.kind === "create" ? mode.start : 0);
  return {
    title: item?.title ?? "",
    mode: item?.mode ?? "operations",
    category: item?.category ?? "match",
    status: item?.status ?? "draft",
    start: toDatetimeLocal(start),
    end: toDatetimeLocal(item?.endAt ?? start + HOUR_MS),
    ownerId: item?.owner?.id ?? ownerId,
    source: item?.source ?? "",
    departmentIds: item?.departmentIds ?? [],
    riskLevel: item?.riskLevel ?? NONE,
    blockedReason: item?.blockedReason ?? "",
    visibility: item?.visibility ?? "internal",
    confirm: false,
    game: item?.game ?? NONE,
    matchId: item?.matchId ?? "",
    teams: item?.teams.join(", ") ?? "",
    venue: item?.venue ?? "",
    streamPlatform: item?.streamPlatform ?? "",
    scoreboardUrl: item?.scoreboardUrl ?? "",
    meetingLink: item?.meetingLink ?? "",
    agenda: item?.agenda ?? "",
    feature: item?.feature ?? "",
    environment: item?.environment ?? "",
    notes: item?.notes ?? "",
    reason: "",
  };
}

const orNull = (value: string) => value.trim() || null;
const noneToNull = <T extends string>(value: string) => (value === NONE ? null : (value as T));

function payload(values: FormValues, canApprove: boolean): Omit<CalendarInput, "confirm"> {
  return {
    title: values.title.trim(),
    mode: values.mode,
    category: values.category as CalendarCategory,
    status: values.status as CalendarStatus,
    startAt: fromDatetimeLocal(values.start) ?? 0,
    endAt: fromDatetimeLocal(values.end) ?? 0,
    ownerId: values.ownerId,
    source: values.source.trim(),
    departmentIds: values.departmentIds,
    riskLevel: noneToNull<(typeof RISK_LEVELS)[number]>(values.riskLevel),
    blockedReason: orNull(values.blockedReason),
    ...(canApprove ? { visibility: values.visibility } : {}),
    game: noneToNull<(typeof GAMES)[number]>(values.game),
    matchId: orNull(values.matchId),
    teams: values.teams
      .split(",")
      .map((team) => team.trim())
      .filter(Boolean),
    venue: orNull(values.venue),
    streamPlatform: orNull(values.streamPlatform),
    scoreboardUrl: orNull(values.scoreboardUrl),
    meetingLink: orNull(values.meetingLink),
    agenda: orNull(values.agenda),
    feature: orNull(values.feature),
    environment: orNull(values.environment),
    notes: orNull(values.notes),
  };
}

type Option = { value: string; label: string };

function OptionSelect({
  id,
  label,
  value,
  options,
  onChange,
  invalid,
  errors,
}: {
  id: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  invalid?: boolean;
  errors?: unknown[];
}) {
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options}
        value={value || null}
        onValueChange={(next: string | null) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
          <SelectValue placeholder="เลือก" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errors && <FieldError errors={errors as { message?: string }[]} />}
    </Field>
  );
}

/** Keys of the form values that hold plain text. */
type TextKey = {
  [K in keyof FormValues]: FormValues[K] extends string ? K : never;
}[keyof FormValues];

const STALE_MESSAGE = "มีคนแก้ไขรายการนี้ก่อนคุณ โหลดข้อมูลล่าสุดแล้วลองอีกครั้ง";

export function ItemForm({
  mode,
  canApprove,
  currentUserId,
  onDone,
  onCancel,
  onReload,
}: {
  mode: ItemFormMode;
  canApprove: boolean;
  currentUserId: string;
  onDone: (item: CalendarItem) => void;
  onCancel: () => void;
  /** Reloads the item after someone else saved it first. */
  onReload?: () => void;
}) {
  const { calendar, leadership } = useApis();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<{ message: string; stale: boolean }>();
  const original = mode.kind === "edit" ? mode.item : null;

  const people = useQuery({
    queryKey: ["calendar", "people"],
    queryFn: () => calendar.people(),
    staleTime: 5 * 60_000,
  });
  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => leadership.departments(),
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = payload(values, canApprove);
      if (!original) return calendar.create({ ...body, confirm: values.confirm });
      return calendar.update(original.id, {
        ...body,
        version: original.version,
        ...(values.confirm ? { confirm: true as const } : {}),
        ...(needsReason(values, original) ? { reason: values.reason.trim() } : {}),
      });
    },
    onSuccess: async (item) => {
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      onDone(item);
    },
    onError: (error) =>
      setFormError({
        message: error.message,
        stale: error instanceof ApiError && error.status === 409,
      }),
  });

  const form = useForm({
    defaultValues: defaults(mode, currentUserId),
    validators: { onSubmit: formSchema(original) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      await save.mutateAsync(value).catch(() => {});
    },
  });

  const values = useStore(form.store, (state) => state.values);
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const askReason = needsReason(values, original);

  const textField = (
    name: TextKey,
    label: string,
    options: { description?: string; type?: string; multiline?: boolean } = {},
  ) => {
    const id = `calendar-${name}`;
    return (
      <form.Field name={name}>
        {(field) => (
          <Field data-invalid={!field.state.meta.isValid}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {options.multiline ? (
              <Textarea
                id={id}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={!field.state.meta.isValid}
              />
            ) : (
              <Input
                id={id}
                type={options.type ?? "text"}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={!field.state.meta.isValid}
              />
            )}
            {options.description && <FieldDescription>{options.description}</FieldDescription>}
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
    );
  };

  const modeOptions = CALENDAR_MODES.map((value) => ({ value, label: MODE_LABELS[value] }));
  const categoryOptions = CATEGORIES_BY_MODE[values.mode].map((value) => ({
    value,
    label: CATEGORY_LABELS[value],
  }));
  const statusOptions = statusesFor(values.mode).map((value) => ({
    value,
    label: STATUS_LABELS[value],
  }));
  const ownerOptions = [
    ...(original?.owner && !people.data?.items.some((p) => p.id === original.owner?.id)
      ? [{ value: original.owner.id, label: original.owner.name }]
      : []),
    ...(people.data?.items.map((person) => ({
      value: person.id,
      label: person.departmentName ? `${person.name} (${person.departmentName})` : person.name,
    })) ?? []),
  ];
  const isOperations = values.mode === "operations";
  const isDelivery = values.mode === "delivery";
  const isMeeting = values.mode === "coordination" || values.mode === "meetings";

  return (
    <form
      noValidate
      aria-label={original ? "แก้ไขรายการ" : "เพิ่มรายการ"}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        {textField("title", "ชื่อรายการ")}

        <div className="grid gap-4 sm:grid-cols-3">
          <form.Field name="mode">
            {(field) => (
              <OptionSelect
                id="calendar-mode"
                label="โหมด"
                value={field.state.value}
                options={modeOptions}
                onChange={(next) => {
                  const nextMode = next as CalendarMode;
                  field.handleChange(nextMode);
                  // Keep the category and status valid for the new mode.
                  const categories = CATEGORIES_BY_MODE[nextMode];
                  if (!categories.includes(form.getFieldValue("category") as CalendarCategory)) {
                    form.setFieldValue("category", categories[0] ?? "");
                  }
                  const statuses = statusesFor(nextMode);
                  if (!statuses.includes(form.getFieldValue("status") as CalendarStatus)) {
                    form.setFieldValue("status", statuses[0] ?? "");
                  }
                }}
              />
            )}
          </form.Field>
          <form.Field name="category">
            {(field) => (
              <OptionSelect
                id="calendar-category"
                label="ประเภท"
                value={field.state.value}
                options={categoryOptions}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="status">
            {(field) => (
              <OptionSelect
                id="calendar-status"
                label="สถานะ"
                value={field.state.value}
                options={statusOptions}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {textField("start", "เริ่ม", {
            description: "เวลาไทย (UTC+07:00)",
            type: "datetime-local",
          })}
          {textField("end", "สิ้นสุด", { type: "datetime-local" })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="ownerId">
            {(field) => (
              <OptionSelect
                id="calendar-owner"
                label="ผู้รับผิดชอบ"
                value={field.state.value}
                options={ownerOptions}
                onChange={field.handleChange}
                invalid={!field.state.meta.isValid}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
          {textField("source", "แหล่งข้อมูล", { description: "เช่น ตารางแข่งจากฝ่ายกีฬา v2" })}
        </div>

        <form.Field name="confirm">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id="calendar-confirm"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldLabel htmlFor="calendar-confirm">ตรวจกับแหล่งข้อมูลแล้ว (ยืนยันข้อมูลตอนนี้)</FieldLabel>
            </Field>
          )}
        </form.Field>

        {askReason &&
          textField("reason", "เหตุผลที่เลื่อนหรือยกเลิก", {
            description: "บันทึกไว้ในประวัติการเปลี่ยนแปลง",
          })}

        {isOperations && (
          <FieldSet>
            <FieldLegend variant="label">การแข่งขันและไลฟ์</FieldLegend>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="game">
                {(field) => (
                  <OptionSelect
                    id="calendar-game"
                    label="เกม"
                    value={field.state.value}
                    options={[
                      { value: NONE, label: "ไม่ระบุ" },
                      ...GAMES.map((game) => ({ value: game, label: GAME_LABELS[game] })),
                    ]}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
              {textField("matchId", "Match ID")}
              {textField("teams", "ทีม", { description: "คั่นแต่ละทีมด้วยจุลภาค" })}
              {textField("venue", "สถานที่")}
              {textField("streamPlatform", "แพลตฟอร์มสตรีม")}
              {textField("scoreboardUrl", "ลิงก์ Scoreboard", { type: "url" })}
            </div>
          </FieldSet>
        )}

        {isMeeting && (
          <FieldSet>
            <FieldLegend variant="label">การประชุมและประสานงาน</FieldLegend>
            {textField("meetingLink", "ลิงก์ประชุม", { type: "url" })}
            {textField("agenda", "วาระ", { multiline: true })}
          </FieldSet>
        )}

        {isDelivery && (
          <FieldSet>
            <FieldLegend variant="label">ฟีเจอร์และ Release</FieldLegend>
            <div className="grid gap-4 sm:grid-cols-2">
              {textField("feature", "ฟีเจอร์/Release")}
              {textField("environment", "Environment")}
            </div>
          </FieldSet>
        )}

        <form.Field name="departmentIds">
          {(field) => (
            <FieldSet>
              <FieldLegend variant="label">ฝ่ายที่เกี่ยวข้อง</FieldLegend>
              <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {departments.data?.map((department) => {
                  const id = `calendar-department-${department.id}`;
                  const checked = field.state.value.includes(department.id);
                  return (
                    <Field key={department.id} orientation="horizontal">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) =>
                          field.handleChange(
                            next
                              ? [...field.state.value, department.id]
                              : field.state.value.filter((value) => value !== department.id),
                          )
                        }
                      />
                      <FieldLabel htmlFor={id} className="font-normal">
                        {department.name}
                      </FieldLabel>
                    </Field>
                  );
                })}
              </div>
            </FieldSet>
          )}
        </form.Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="riskLevel">
            {(field) => (
              <OptionSelect
                id="calendar-risk"
                label="ความเสี่ยง"
                value={field.state.value}
                options={[
                  { value: NONE, label: "ไม่ระบุ" },
                  ...RISK_LEVELS.map((risk) => ({ value: risk, label: RISK_LABELS[risk] })),
                ]}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          {canApprove && (
            <form.Field name="visibility">
              {(field) => (
                <OptionSelect
                  id="calendar-visibility"
                  label="การเผยแพร่"
                  value={field.state.value}
                  options={(["internal", "public"] as const).map((value) => ({
                    value,
                    label: VISIBILITY_LABELS[value],
                  }))}
                  onChange={(next) => field.handleChange(next as "internal" | "public")}
                />
              )}
            </form.Field>
          )}
        </div>
        {textField("blockedReason", "สิ่งที่ติดขัด (Blocked)", {
          description: "เว้นว่างถ้าไม่มี ถ้าใส่ รายการจะแสดงป้าย Blocked",
        })}
        {textField("notes", "โน้ตภายใน", { multiline: true })}

        {formError && (
          <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
            <p>บันทึกไม่สำเร็จ: {formError.stale ? STALE_MESSAGE : formError.message}</p>
            {formError.stale && onReload && (
              <Button type="button" variant="outline" size="sm" onClick={onReload}>
                โหลดข้อมูลล่าสุด
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {isDirty && <span className="mr-auto text-xs text-muted-foreground">ยังไม่ได้บันทึก</span>}
          <Button type="button" variant="ghost" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            บันทึก
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
