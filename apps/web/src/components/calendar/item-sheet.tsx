import { Button } from "@it3k/ui/components/button";
import { Field, FieldLabel } from "@it3k/ui/components/field";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  CalendarX,
  Check,
  CircleCheck,
  CircleDot,
  Clock,
  Handshake,
  History,
  type LucideIcon,
  MapPin,
  MessageSquareText,
  Minus,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  User,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DepartmentBadge, DepartmentIcon } from "@/components/department-icon";
import { useApis } from "@/lib/api-context";
import { formatBangkok, formatRange } from "@/lib/bangkok-time";
import type { CalendarChange, CalendarItemDetail, CalendarUpdate } from "@/lib/calendar";
import type { HintKey } from "@/lib/calendar-hints";
import { ACTION_ICONS, FALLBACK_ACTION_ICON, STATUS_ICONS } from "@/lib/calendar-icons";
import { ACTION_LABELS, FIELD_LABELS, STATUS_LABELS } from "@/lib/calendar-labels";
import { ApiError, type LeadershipDepartment } from "@/lib/leadership";

import { Hint } from "./hint";
import { IconLabel } from "./icon-label";
import { type CalendarViewer, ItemForm, type ItemFormMode } from "./item-form";
import { SideDrawer } from "./side-drawer";

const TIME_FIELDS = new Set(["startAt", "endAt"]);
const LABELLED: Record<string, Record<string, string>> = {
  status: STATUS_LABELS,
};

const DELETED_DEPARTMENT = "แผนกที่ถูกลบ";
/** An account id was set: who it is means nothing to a reader of the log. */
export const ACCOUNT_SET = Symbol("account set");

/**
 * A change-log value in words: times in Bangkok, enums in Thai. Returns null
 * for "nothing" and ACCOUNT_SET for an account id, which the log shows as icons.
 */
export function describeValue(
  field: string,
  value: unknown,
  departmentNames: Map<string, string>,
): string | null | typeof ACCOUNT_SET {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  if (TIME_FIELDS.has(field) && typeof value === "number") return formatBangkok(value, "dateTime");
  if (field === "departmentId") return departmentNames.get(String(value)) ?? DELETED_DEPARTMENT;
  if (field === "collaboratorIds" && Array.isArray(value)) {
    return value.map((id) => departmentNames.get(String(id)) ?? DELETED_DEPARTMENT).join(", ");
  }
  const labels = LABELLED[field];
  if (labels && typeof value === "string") return labels[value] ?? value;
  if (Array.isArray(value)) return value.join(", ");
  // Ids of accounts mean nothing to a reader.
  if (field.endsWith("Id")) return ACCOUNT_SET;
  return String(value);
}

/** One side of a change: the value in words, or an icon for "nothing" and "set". */
function ChangeValue({
  field,
  value,
  departmentNames,
}: {
  field: string;
  value: unknown;
  departmentNames: Map<string, string>;
}) {
  const text = describeValue(field, value, departmentNames);
  if (text === null) {
    return (
      <span className="inline-flex items-center">
        <Minus aria-hidden className="size-3.5" />
        <span className="sr-only">ไม่มี</span>
      </span>
    );
  }
  if (text === ACCOUNT_SET) {
    return (
      <span className="inline-flex items-center">
        <Check aria-hidden className="size-3.5" />
        <span className="sr-only">ระบุแล้ว</span>
      </span>
    );
  }
  return <span className="min-w-0 break-words">{text}</span>;
}

const IMPORTANT_ACTIONS = new Set(["reschedule", "cancel", "delete"]);

/** Moves, cancellations, deletions and handovers: the changes to spot first. */
export function isImportantChange(change: Pick<CalendarChange, "action" | "changes">) {
  if (IMPORTANT_ACTIONS.has(change.action)) return true;
  return "ownerId" in change.changes;
}

function ChangeLog({
  changes,
  departmentNames,
}: {
  changes: CalendarChange[];
  departmentNames: Map<string, string>;
}) {
  return (
    <ol className="flex flex-col gap-3" aria-label="ประวัติการเปลี่ยนแปลง">
      {changes.map((change) => {
        const Icon = ACTION_ICONS[change.action] ?? FALLBACK_ACTION_ICON;
        return (
          <li
            key={change.id}
            className={cn(
              "border-l-2 pl-3 text-xs",
              isImportantChange(change) && "border-l-amber-500",
            )}
          >
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                {ACTION_LABELS[change.action] ?? change.action}
              </span>
              <span className="flex items-center gap-1.5">
                <UserRound aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                {change.actorName ?? "ผู้ใช้ที่ถูกลบ"}
              </span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
              <Clock aria-hidden className="size-3.5 shrink-0" />
              {formatBangkok(change.createdAt, "dateTime")}
            </p>
            {change.reason && (
              <p className="mt-1 flex items-start gap-1.5">
                <MessageSquareText
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <span>
                  <span className="sr-only">เหตุผล: </span>
                  {change.reason}
                </span>
              </p>
            )}
            {change.action !== "create" && (
              <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                {Object.entries(change.changes).map(([field, pair]) => {
                  const [before, after] = pair as [unknown, unknown];
                  return (
                    <li key={field} className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground/80">
                        {FIELD_LABELS[field] ?? field}
                      </span>
                      <ChangeValue field={field} value={before} departmentNames={departmentNames} />
                      <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                      <span className="sr-only">เป็น</span>
                      <ChangeValue field={field} value={after} departmentNames={departmentNames} />
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Detail({
  label,
  icon: Icon,
  hint,
  children,
}: {
  label: string;
  icon: LucideIcon;
  hint?: HintKey;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <dt className="flex items-start gap-1.5 text-muted-foreground">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {label}
        {hint && <Hint hint={hint} label={label} />}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ItemDetails({ item }: { item: CalendarItemDetail }) {
  return (
    <dl className="flex flex-col gap-2">
      <Detail label="เวลา" icon={Clock}>
        {formatBangkok(item.startAt, "longDay")} {formatRange(item.startAt, item.endAt)}
        <span className="text-muted-foreground"> (เวลาไทย)</span>
      </Detail>
      <Detail label="แผนก" icon={Building2} hint="department">
        <DepartmentBadge department={item.department} />
      </Detail>
      {item.collaborators.length > 0 && (
        <Detail label="ทำงานร่วมกับ" icon={Handshake} hint="collaborators">
          <span className="flex flex-wrap gap-1">
            {item.collaborators.map((department) => (
              <DepartmentBadge key={department.id} department={department} />
            ))}
          </span>
        </Detail>
      )}
      <Detail label="สถานะ" icon={CircleDot} hint="status">
        <IconLabel icon={STATUS_ICONS[item.status]}>{STATUS_LABELS[item.status]}</IconLabel>
      </Detail>
      {item.venue && (
        <Detail label="สถานที่" icon={MapPin}>
          {item.venue}
        </Detail>
      )}
      {item.owner && (
        <Detail label="ผู้รับผิดชอบ" icon={User}>
          {item.owner.name}
        </Detail>
      )}
      {item.notes && (
        <Detail label="โน้ตภายใน" icon={StickyNote} hint="notes">
          <span className="whitespace-pre-wrap">{item.notes}</span>
        </Detail>
      )}
    </dl>
  );
}

type Asking = "cancel" | "delete";

function Actions({
  item,
  onEdit,
  onDeleted,
}: {
  item: CalendarItemDetail;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { calendar } = useApis();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<Asking>();
  const [reason, setReason] = useState("");

  const onError = (error: Error) =>
    toast.error(
      error instanceof ApiError && error.status === 409
        ? "มีคนแก้ไขรายการนี้ก่อนคุณ ข้อมูลล่าสุดโหลดให้แล้ว"
        : `บันทึกไม่สำเร็จ: ${error.message}`,
      { id: "calendar-update" },
    );
  const refreshOnConflict = (error: Error | null) => {
    if (error instanceof ApiError && error.status === 409) {
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    }
  };

  const update = useMutation({
    mutationFn: (json: Omit<CalendarUpdate, "version">) =>
      calendar.update(item.id, { ...json, version: item.version }),
    onSuccess: async () => {
      setAsking(undefined);
      setReason("");
      toast.success("บันทึกแล้ว");
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError,
    onSettled: (_data, error) => refreshOnConflict(error),
  });

  const remove = useMutation({
    mutationFn: () => calendar.remove(item.id, item.version),
    onSuccess: async () => {
      toast.success("ลบรายการแล้ว");
      onDeleted();
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError,
    onSettled: (_data, error) => refreshOnConflict(error),
  });

  if (!item.canEdit) return null;
  const pending = update.isPending || remove.isPending;
  // Only a confirmed plan needs a reason to be called off, as on the server.
  const cancelNeedsReason = item.status === "confirmed";

  if (asking === "cancel") {
    return (
      <form
        className="flex flex-col gap-2 rounded-xl border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (cancelNeedsReason && !reason.trim()) return;
          update.mutate({ status: "cancelled", reason: reason.trim() || null });
        }}
      >
        <Field>
          <FieldLabel htmlFor="calendar-cancel-reason">
            เหตุผลที่ยกเลิก{!cancelNeedsReason && " (ไม่บังคับ)"}
          </FieldLabel>
          <Textarea
            id="calendar-cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required={cancelNeedsReason}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(undefined)}>
            ไม่ยกเลิก
          </Button>
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            disabled={(cancelNeedsReason && !reason.trim()) || pending}
          >
            <CalendarX data-icon="inline-start" />
            ยืนยันยกเลิกรายการ
          </Button>
        </div>
      </form>
    );
  }

  if (asking === "delete") {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive/40 p-3">
        <p className="text-sm">
          ลบ "{item.title}" ออกจากปฏิทิน? ประวัติการเปลี่ยนแปลงยังเก็บไว้ แต่ดูจากปฏิทินไม่ได้แล้ว
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(undefined)}>
            ไม่ลบ
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => remove.mutate()}
          >
            <Trash2 data-icon="inline-start" />
            ยืนยันลบรายการ
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onEdit} disabled={pending}>
        <Pencil data-icon="inline-start" />
        แก้ไข
      </Button>
      {item.status === "draft" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => update.mutate({ status: "confirmed" })}
        >
          <CircleCheck data-icon="inline-start" />
          ยืนยันรายการ
        </Button>
      )}
      {item.status !== "cancelled" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setAsking("cancel")}>
          <CalendarX data-icon="inline-start" />
          ยกเลิกรายการ
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsking("delete")}>
        <Trash2 data-icon="inline-start" />
        ลบ
      </Button>
    </div>
  );
}

/** The selected item: details, actions and history, or the edit form. */
export function ItemSheet({
  itemId,
  create,
  viewer,
  onSelect,
  onClose,
}: {
  itemId: string | null;
  /** Opens the create form, starting at this time in this department. */
  create: { start: number; departmentId: string | null } | null;
  viewer: CalendarViewer;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { calendar, leadership } = useApis();
  const [editing, setEditing] = useState(false);
  const open = itemId !== null || create !== null;

  const detail = useQuery({
    queryKey: ["calendar", "item", itemId],
    queryFn: () => calendar.get(itemId ?? ""),
    enabled: itemId !== null,
  });
  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => leadership.departments(),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const departmentList: LeadershipDepartment[] = departments.data ?? [];
  const departmentNames = new Map(departmentList.map((d) => [d.id, d.name]));

  const close = () => {
    setEditing(false);
    onClose();
  };
  const formMode: ItemFormMode | null =
    create !== null
      ? { kind: "create", ...create }
      : editing && detail.data
        ? { kind: "edit", item: detail.data }
        : null;
  const title =
    create !== null
      ? "เพิ่มรายการ"
      : (detail.data?.title ?? (detail.isPending ? "กำลังโหลด" : "รายการ"));

  return (
    <SideDrawer
      open={open}
      onOpenChange={(next) => !next && close()}
      title={
        <span className="flex items-center gap-2">
          {create !== null ? (
            <Plus aria-hidden className="size-5 text-primary" />
          ) : (
            detail.data && <DepartmentIcon department={detail.data.department} className="size-7" />
          )}
          {title}
        </span>
      }
    >
      <div className="flex flex-col gap-6">
        {formMode ? (
          <ItemForm
            // A fresh form whenever the item's saved version changes.
            key={formMode.kind === "edit" ? `${formMode.item.id}:${formMode.item.version}` : "new"}
            mode={formMode}
            viewer={viewer}
            departments={departmentList}
            onCancel={() => (create !== null ? close() : setEditing(false))}
            onReload={() => void detail.refetch()}
            onDone={(item) => {
              toast.success(create !== null ? "เพิ่มรายการแล้ว" : "บันทึกแล้ว");
              setEditing(false);
              onSelect(item.id);
            }}
          />
        ) : detail.isPending && itemId !== null ? (
          <div className="flex flex-col gap-2" role="status" aria-label="กำลังโหลด">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : detail.isError ? (
          <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
            <p>
              {detail.error instanceof ApiError && detail.error.status === 404
                ? "ไม่พบรายการนี้"
                : `โหลดรายการไม่สำเร็จ: ${detail.error.message}`}
            </p>
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              ลองอีกครั้ง
            </Button>
          </div>
        ) : detail.data ? (
          <>
            <Actions item={detail.data} onEdit={() => setEditing(true)} onDeleted={close} />
            <ItemDetails item={detail.data} />
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History aria-hidden className="size-4 text-primary" />
                ประวัติการเปลี่ยนแปลง
              </h3>
              <ChangeLog changes={detail.data.changes} departmentNames={departmentNames} />
            </section>
          </>
        ) : null}
      </div>
    </SideDrawer>
  );
}
