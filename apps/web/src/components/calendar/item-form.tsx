import { CALENDAR_STATUSES, type CalendarStatus } from "@it3k/db/calendar-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@it3k/ui/components/collapsible";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
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
import { cn } from "@it3k/ui/lib/utils";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, type LucideIcon, Save, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { z } from "zod";

import { DepartmentLabel } from "@/components/department-icon";
import { useApis } from "@/lib/api-context";
import { HOUR_MS, fromDatetimeLocal, toDatetimeLocal } from "@/lib/bangkok-time";
import type { CalendarInput, CalendarItem, CalendarItemDetail } from "@/lib/calendar";
import type { HintKey } from "@/lib/calendar-hints";
import { OPTION_ICONS, STATUS_ICONS, VISIBILITY_ICONS } from "@/lib/calendar-icons";
import { STATUS_LABELS, VISIBILITY_LABELS } from "@/lib/calendar-labels";
import { ApiError, type LeadershipDepartment } from "@/lib/leadership";

import { DateTimePicker } from "./date-time-picker";
import { Hint } from "./hint";
import { IconLabel } from "./icon-label";

export type ItemFormMode =
  | { kind: "create"; start: number; departmentId: string | null }
  | { kind: "edit"; item: CalendarItemDetail };

/** What the viewer may do, from the calendar page's list response. */
export type CalendarViewer = {
  departmentId: string | null;
  isAdmin: boolean;
  canPublishOwn: boolean;
};

const NONE = "__none__";

const text = (max: number) => z.string().trim().max(max, `ยาวเกิน ${max} ตัวอักษร`);

// Mirrors the server's rules so mistakes show up before a round trip; the
// server still validates everything.
const fields = z.object({
  title: text(200).min(1, "กรุณาใส่ชื่อรายการ"),
  departmentId: z.string().min(1, "กรุณาเลือกแผนก"),
  status: z.enum(CALENDAR_STATUSES),
  start: z.string().refine((value) => fromDatetimeLocal(value) !== null, "กรุณาใส่เวลาเริ่ม"),
  end: z.string().refine((value) => fromDatetimeLocal(value) !== null, "กรุณาใส่เวลาสิ้นสุด"),
  venue: text(120),
  ownerId: z.string(),
  notes: text(4000),
  collaboratorIds: z.array(z.string()),
  visibility: z.enum(["internal", "public"]),
  reason: text(500),
});

type FormValues = z.input<typeof fields>;

/** Moving or cancelling a confirmed item must say why; the change log keeps the reason. */
function needsReason(values: FormValues, original: CalendarItemDetail | null) {
  return (
    original !== null &&
    original.status === "confirmed" &&
    (fromDatetimeLocal(values.start) !== original.startAt ||
      fromDatetimeLocal(values.end) !== original.endAt ||
      values.status === "cancelled")
  );
}

function formSchema(original: CalendarItemDetail | null) {
  return fields.superRefine((values, ctx) => {
    const start = fromDatetimeLocal(values.start);
    const end = fromDatetimeLocal(values.end);
    if (start !== null && end !== null && end <= start) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "เวลาสิ้นสุดต้องหลังเวลาเริ่ม" });
    }
    if (values.visibility === "public" && values.status !== "confirmed") {
      ctx.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "เผยแพร่สาธารณะได้เฉพาะรายการที่ยืนยันแล้ว",
      });
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

function defaults(mode: ItemFormMode): FormValues {
  const item = mode.kind === "edit" ? mode.item : null;
  const start = item?.startAt ?? (mode.kind === "create" ? mode.start : 0);
  return {
    title: item?.title ?? "",
    departmentId: item?.department.id ?? (mode.kind === "create" ? (mode.departmentId ?? "") : ""),
    status: item?.status ?? "confirmed",
    start: toDatetimeLocal(start),
    end: toDatetimeLocal(item?.endAt ?? start + HOUR_MS),
    venue: item?.venue ?? "",
    ownerId: item?.owner?.id ?? NONE,
    notes: item?.notes ?? "",
    collaboratorIds: item?.collaborators.map((department) => department.id) ?? [],
    visibility: item?.visibility ?? "internal",
    reason: "",
  };
}

const orNull = (value: string) => value.trim() || null;

function payload(values: FormValues, canPublish: boolean): CalendarInput {
  return {
    title: values.title.trim(),
    departmentId: values.departmentId,
    status: values.status,
    startAt: fromDatetimeLocal(values.start) ?? 0,
    endAt: fromDatetimeLocal(values.end) ?? 0,
    venue: orNull(values.venue),
    ownerId: values.ownerId === NONE ? null : values.ownerId,
    notes: orNull(values.notes),
    // The owning department is never also a collaborator.
    collaboratorIds: values.collaboratorIds.filter((id) => id !== values.departmentId),
    ...(canPublish ? { visibility: values.visibility } : {}),
  };
}

/** A field label with an optional (?) beside it, outside the `<label>`. */
function LabelRow({ htmlFor, label, hint }: { htmlFor: string; label: string; hint?: HintKey }) {
  return (
    <div className="flex items-center gap-1">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {hint && <Hint hint={hint} label={label} />}
    </div>
  );
}

type Option = { value: string; label: string; icon?: LucideIcon | null; content?: ReactNode };

function OptionSelect({
  id,
  label,
  value,
  options,
  onChange,
  invalid,
  errors,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  invalid?: boolean;
  errors?: unknown[];
  hint?: HintKey;
}) {
  const labelOf = (option: Option) =>
    option.content ?? <IconLabel icon={option.icon}>{option.label}</IconLabel>;
  return (
    <Field data-invalid={invalid}>
      <LabelRow htmlFor={id} label={label} hint={hint} />
      <Select
        // Labels are elements, so the trigger shows the chosen option's icon too.
        items={options.map((option) => ({ value: option.value, label: labelOf(option) }))}
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
              {labelOf(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errors && <FieldError errors={errors as { message?: string }[]} />}
    </Field>
  );
}

/** Keys of the form values that hold plain text. */
type TextKey = "title" | "venue" | "notes" | "reason";

const STALE_MESSAGE = "มีคนแก้ไขรายการนี้ก่อนคุณ โหลดข้อมูลล่าสุดแล้วลองอีกครั้ง";
const OPTIONAL_FIELDS = ["venue", "ownerId", "notes"] as const;

export function ItemForm({
  mode,
  viewer,
  departments,
  onDone,
  onCancel,
  onReload,
}: {
  mode: ItemFormMode;
  viewer: CalendarViewer;
  departments: LeadershipDepartment[];
  onDone: (item: CalendarItem) => void;
  onCancel: () => void;
  /** Reloads the item after someone else saved it first. */
  onReload?: () => void;
}) {
  const { calendar } = useApis();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<{ message: string; stale: boolean }>();
  const original = mode.kind === "edit" ? mode.item : null;

  const people = useQuery({
    queryKey: ["calendar", "people"],
    queryFn: () => calendar.people(),
    staleTime: 5 * 60_000,
  });

  const form = useForm({
    defaultValues: defaults(mode),
    validators: { onSubmit: formSchema(original) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      await save.mutateAsync(value).catch(() => {});
    },
  });

  const values = useStore(form.store, (state) => state.values);
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const fieldMeta = useStore(form.store, (state) => state.fieldMeta) as Record<
    string,
    { errors?: unknown[] } | undefined
  >;
  const askReason = needsReason(values, original);
  const canPublish =
    viewer.isAdmin ||
    (original
      ? original.canPublish
      : viewer.canPublishOwn && values.departmentId === viewer.departmentId);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = payload(values, canPublish);
      if (!original) return calendar.create(body);
      // Only admins move items; everyone else leaves the department alone.
      const { departmentId, ...rest } = body;
      return calendar.update(original.id, {
        ...rest,
        ...(viewer.isAdmin ? { departmentId } : {}),
        version: original.version,
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

  const textField = (
    name: TextKey,
    label: string,
    options: { description?: string; multiline?: boolean; hint?: HintKey } = {},
  ) => {
    const id = `calendar-${name}`;
    return (
      <form.Field name={name}>
        {(field) => (
          <Field data-invalid={!field.state.meta.isValid}>
            <LabelRow htmlFor={id} label={label} hint={options.hint} />
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

  const ownerOptions: Option[] = [
    { value: NONE, label: "ไม่ระบุ", icon: OPTION_ICONS.none },
    ...(original?.owner && !people.data?.items.some((p) => p.id === original.owner?.id)
      ? [{ value: original.owner.id, label: original.owner.name, icon: OPTION_ICONS.person }]
      : []),
    ...(people.data?.items.map((person) => ({
      value: person.id,
      label: person.departmentName ? `${person.name} (${person.departmentName})` : person.name,
      icon: OPTION_ICONS.person,
    })) ?? []),
  ];
  const departmentOptions: Option[] = departments.map((department) => ({
    value: department.id,
    label: department.name,
    content: <DepartmentLabel department={department} />,
  }));
  const ownDepartment = departments.find((d) => d.id === values.departmentId);

  const optionalFilled =
    OPTIONAL_FIELDS.filter((name) => {
      const value = values[name];
      return value.trim() !== "" && value !== NONE;
    }).length + (values.collaboratorIds.length > 0 ? 1 : 0);
  const optionalInvalid = OPTIONAL_FIELDS.some(
    (name) => (fieldMeta[name]?.errors?.length ?? 0) > 0,
  );
  const [moreOpen, setMoreOpen] = useState(optionalFilled > 0);
  const showMore = moreOpen || optionalInvalid;

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
        <div className="grid gap-4 sm:grid-cols-2">
          {viewer.isAdmin ? (
            <form.Field name="departmentId">
              {(field) => (
                <OptionSelect
                  id="calendar-department"
                  hint="department"
                  label="แผนก"
                  value={field.state.value}
                  options={departmentOptions}
                  onChange={(next) => {
                    field.handleChange(next);
                    // The new owner stops being a collaborator.
                    form.setFieldValue(
                      "collaboratorIds",
                      form.getFieldValue("collaboratorIds").filter((id) => id !== next),
                    );
                  }}
                  invalid={!field.state.meta.isValid}
                  errors={field.state.meta.errors}
                />
              )}
            </form.Field>
          ) : (
            <Field>
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium">แผนก</span>
                <Hint hint="department" label="แผนก" />
              </div>
              <div className="flex h-9 items-center text-sm">
                {ownDepartment ? <DepartmentLabel department={ownDepartment} /> : "—"}
              </div>
            </Field>
          )}
          <form.Field name="status">
            {(field) => (
              <OptionSelect
                id="calendar-status"
                hint="status"
                label="สถานะ"
                value={field.state.value}
                options={CALENDAR_STATUSES.map((value) => ({
                  value,
                  label: STATUS_LABELS[value],
                  icon: STATUS_ICONS[value],
                }))}
                onChange={(next) => field.handleChange(next as CalendarStatus)}
              />
            )}
          </form.Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["start", "end"] as const).map((name) => (
            <form.Field key={name} name={name}>
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <LabelRow
                    htmlFor={`calendar-${name}`}
                    label={name === "start" ? "เริ่ม" : "สิ้นสุด"}
                    hint={name === "start" ? "start" : undefined}
                  />
                  <DateTimePicker
                    id={`calendar-${name}`}
                    label={name === "start" ? "เริ่ม" : "สิ้นสุด"}
                    value={field.state.value}
                    onChange={field.handleChange}
                    onBlur={field.handleBlur}
                    invalid={!field.state.meta.isValid}
                  />
                  {name === "start" && <FieldDescription>เวลาไทย (UTC+07:00)</FieldDescription>}
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          ))}
        </div>
        {askReason &&
          textField("reason", "เหตุผลที่เลื่อนหรือยกเลิก", {
            hint: "reason",
            description: "บันทึกไว้ในประวัติการเปลี่ยนแปลง",
          })}
        <Collapsible
          open={showMore}
          onOpenChange={setMoreOpen}
          className={cn("rounded-2xl border", optionalInvalid && "border-destructive/60")}
        >
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50"
              />
            }
          >
            <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">รายละเอียดเพิ่มเติม (ไม่บังคับ)</span>
            {optionalFilled > 0 && <Badge variant="secondary">กรอกแล้ว {optionalFilled}</Badge>}
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                showMore && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          {/* Kept mounted, so folded fields still validate and keep their values. */}
          <CollapsibleContent keepMounted className="flex flex-col gap-4 border-t p-3">
            <div className="grid gap-4 sm:grid-cols-2">
              {textField("venue", "สถานที่", { hint: "venue" })}
              <form.Field name="ownerId">
                {(field) => (
                  <OptionSelect
                    id="calendar-owner"
                    hint="owner"
                    label="ผู้รับผิดชอบ"
                    value={field.state.value}
                    options={ownerOptions}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
            </div>
            <form.Field name="collaboratorIds">
              {(field) => (
                <fieldset
                  className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
                  aria-label="ฝ่ายที่ทำงานร่วมกัน"
                >
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium">ฝ่ายที่ทำงานร่วมกัน</span>
                    <Hint hint="collaborators" label="ฝ่ายที่ทำงานร่วมกัน" />
                  </div>
                  <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {departments
                      .filter((department) => department.id !== values.departmentId)
                      .map((department) => {
                        const id = `calendar-collaborator-${department.id}`;
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
                              <DepartmentLabel department={department} />
                            </FieldLabel>
                          </Field>
                        );
                      })}
                  </div>
                </fieldset>
              )}
            </form.Field>
            {textField("notes", "โน้ตภายใน", { multiline: true, hint: "notes" })}
          </CollapsibleContent>
        </Collapsible>
        {canPublish && (
          <form.Field name="visibility">
            {(field) => (
              <OptionSelect
                id="calendar-visibility"
                hint="visibility"
                label="การเผยแพร่"
                value={field.state.value}
                options={(["internal", "public"] as const).map((value) => ({
                  value,
                  label: VISIBILITY_LABELS[value],
                  icon: VISIBILITY_ICONS[value],
                }))}
                onChange={(next) => field.handleChange(next as "internal" | "public")}
                invalid={!field.state.meta.isValid}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
        )}
        {formError && (
          <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
            <p>
              {formError.stale
                ? `บันทึกไม่สำเร็จ: ${STALE_MESSAGE}`
                : `บันทึกไม่สำเร็จ: ${formError.message}`}
            </p>
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
            {save.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            บันทึก
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
