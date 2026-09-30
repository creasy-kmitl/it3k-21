import type { CalendarStatus } from "@it3k/db/calendar-rules";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field, FieldLabel } from "@it3k/ui/components/field";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Ban,
  CalendarX,
  CircleCheck,
  CircleDot,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Gamepad2,
  Globe,
  Hash,
  Headset,
  History,
  Layers,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  MapPin,
  Pencil,
  Plus,
  Server,
  ShieldAlert,
  Sparkles,
  StickyNote,
  TriangleAlert,
  Trophy,
  Tv,
  User,
  Users,
  Video,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useApis } from "@/lib/api-context";
import { formatBangkok, formatRange } from "@/lib/bangkok-time";
import type {
  CalendarChecklistEntry,
  CalendarChange,
  CalendarItem,
  CalendarItemDetail,
  CalendarUpdate,
} from "@/lib/calendar";
import {
  ACTION_LABELS,
  CHECKLIST_LABELS,
  ACTION_STATUS_LABELS,
  CATEGORY_LABELS,
  FIELD_LABELS,
  GAME_LABELS,
  MODE_LABELS,
  MODE_STYLES,
  REQUEST_STATE_LABELS,
  RISK_LABELS,
  STATUS_LABELS,
  VISIBILITY_LABELS,
} from "@/lib/calendar-labels";
import {
  ACTION_ICONS,
  CATEGORY_ICONS,
  CHECKLIST_ICONS,
  GAME_ICONS,
  MODE_ICONS,
  RISK_ICONS,
  STATUS_ICONS,
  VISIBILITY_ICONS,
} from "@/lib/calendar-icons";
import { ApiError } from "@/lib/leadership";

import { CategoryBadge } from "./agenda-view";
import { CoordinationPanel } from "./coordination-panel";
import { DeliveryPanel } from "./delivery-panel";
import { IconLabel } from "./icon-label";
import { ItemFlags } from "./item-chip";
import { SideDrawer } from "./side-drawer";
import { ItemForm, type ItemFormMode } from "./item-form";

const TIME_FIELDS = new Set([
  "startAt",
  "endAt",
  "lastConfirmedAt",
  "archivedAt",
  "approvedAt",
  "dueAt",
]);
const LABELLED: Record<string, Record<string, string>> = {
  // Items and action items share `status` in the change log.
  status: { ...STATUS_LABELS, ...ACTION_STATUS_LABELS },
  requestState: REQUEST_STATE_LABELS,
  mode: MODE_LABELS,
  category: CATEGORY_LABELS,
  visibility: VISIBILITY_LABELS,
  riskLevel: RISK_LABELS,
  game: GAME_LABELS,
};

/** A change-log value in words: times in Bangkok, enums in Thai. */
export function describeValue(
  field: string,
  value: unknown,
  departmentNames: Map<string, string>,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "ติ๊กแล้ว" : "ยังไม่ติ๊ก";
  if (TIME_FIELDS.has(field) && typeof value === "number") return formatBangkok(value, "dateTime");
  if (field === "departmentIds" && Array.isArray(value)) {
    return value.length
      ? value.map((id) => departmentNames.get(String(id)) ?? "?").join(", ")
      : "—";
  }
  const labels = LABELLED[field];
  if (labels && typeof value === "string") return labels[value] ?? value;
  if (Array.isArray(value)) return value.join(", ");
  // Ids of accounts and items mean nothing to a reader.
  if (field.endsWith("Id") || field.startsWith("duplicated")) return "✓";
  return String(value);
}

/** A change-log field in words, including `checklist.<key>` entries. */
function fieldLabel(field: string) {
  const [group, key] = field.split(".");
  if (key && (group === "checklist" || group === "checklistNote")) {
    const label = CHECKLIST_LABELS[key as keyof typeof CHECKLIST_LABELS] ?? key;
    return group === "checklist" ? `Checklist: ${label}` : `หมายเหตุ checklist: ${label}`;
  }
  return FIELD_LABELS[field] ?? field;
}

function ChecklistIcon({ entryKey }: { entryKey: CalendarChecklistEntry["key"] }) {
  const Icon = CHECKLIST_ICONS[entryKey];
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

function ChecklistPanel({ item }: { item: CalendarItemDetail }) {
  const { calendar } = useApis();
  const queryClient = useQueryClient();
  const tick = useMutation({
    mutationFn: ({ key, checked }: { key: CalendarChecklistEntry["key"]; checked: boolean }) =>
      calendar.check(item.id, key, { checked }),
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 409
          ? "สิทธิ์หรือข้อมูลเปลี่ยนไปแล้ว โหลดข้อมูลล่าสุดให้แล้ว"
          : `บันทึกไม่สำเร็จ: ${error.message}`,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["calendar"] }),
  });
  const checklist = item.checklist ?? [];
  const done = checklist.filter((entry) => entry.checked).length;
  return (
    <section className="flex flex-col gap-2" aria-label="Checklist ไลฟ์">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ListChecks aria-hidden className="size-4 text-primary" />
        Checklist ไลฟ์
        <span
          className={cn(
            "rounded-full px-2 text-xs",
            done === checklist.length ? "bg-emerald-600 text-white" : "bg-muted",
          )}
        >
          {done}/{checklist.length}
        </span>
      </h3>
      <p className="text-xs text-muted-foreground">
        On-call: {item.onCallOwner?.name ?? "ยังไม่ระบุ"} · ต้องครบทุกข้อและมี on-call ก่อนตั้งเป็นพร้อมหรือ Live
      </p>
      <ul className="flex flex-col divide-y rounded-xl border">
        {checklist.map((entry) => {
          const id = `checklist-${entry.key}`;
          return (
            <li key={entry.key} className="flex items-start gap-2 p-2 text-sm">
              <Checkbox
                id={id}
                checked={entry.checked}
                disabled={!item.canCheck || tick.isPending}
                onCheckedChange={(checked) => tick.mutate({ key: entry.key, checked })}
                className="mt-0.5"
              />
              <label htmlFor={id} className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                  <ChecklistIcon entryKey={entry.key} />
                  {CHECKLIST_LABELS[entry.key]}
                </span>
                {entry.checked && entry.checkedAt && (
                  <span className="text-xs text-muted-foreground">
                    {entry.checkedBy ?? "—"} · {formatBangkok(entry.checkedAt, "dateTime")}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const IMPORTANT_ACTIONS = new Set(["reschedule", "cancel", "release_approval", "publish"]);
const IMPORTANT_FIELDS = [
  "ownerId",
  "onCallOwnerId",
  "scoreboardOperatorId",
  "monitoringOwnerId",
  "venue",
  "streamPlatform",
  "conflicts",
];
const IMPORTANT_STATUSES = new Set(["live", "released", "rolled_back", "delayed"]);

/**
 * Changes that touch a live block, the people on it, the venue or stream,
 * or a release: the ones to spot first when reading the history.
 */
export function isImportantChange(change: Pick<CalendarChange, "action" | "changes">) {
  if (IMPORTANT_ACTIONS.has(change.action)) return true;
  const fields = Object.keys(change.changes);
  if (fields.some((field) => IMPORTANT_FIELDS.includes(field))) return true;
  const status = (change.changes as Record<string, [unknown, unknown]>).status?.[1];
  return typeof status === "string" && IMPORTANT_STATUSES.has(status);
}

function ActionIcon({ action }: { action: CalendarChange["action"] }) {
  const Icon = ACTION_ICONS[action];
  return <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
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
      {changes.map((change) => (
        <li
          key={change.id}
          className={cn(
            "border-l-2 pl-3 text-xs",
            isImportantChange(change) && "border-l-amber-500",
          )}
        >
          <p className="flex items-center gap-1.5 font-medium">
            <ActionIcon action={change.action} />
            {ACTION_LABELS[change.action]} · {change.actorName ?? "ผู้ใช้ที่ถูกลบ"}
            {isImportantChange(change) && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-black">สำคัญ</span>
            )}
          </p>
          <p className="text-muted-foreground">{formatBangkok(change.createdAt, "dateTime")}</p>
          {change.reason && <p className="mt-1">เหตุผล: {change.reason}</p>}
          {change.action !== "create" && (
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {Object.entries(change.changes).map(([field, pair]) => {
                const [before, after] = pair as [unknown, unknown];
                return (
                  <li key={field}>
                    {fieldLabel(field)}: {describeValue(field, before, departmentNames)} →{" "}
                    {describeValue(field, after, departmentNames)}
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

const DETAIL_ICONS: Record<string, LucideIcon> = {
  เวลา: Clock,
  โหมด: Layers,
  สถานะ: CircleDot,
  ผู้รับผิดชอบ: User,
  "On-call": Headset,
  "คนคุม Scoreboard": Trophy,
  แผนรับมือการชน: ShieldAlert,
  แหล่งข้อมูล: FileText,
  ยืนยันล่าสุด: CircleCheck,
  การเผยแพร่: Eye,
  ความเสี่ยง: TriangleAlert,
  สิ่งที่ติดขัด: Ban,
  เกม: Gamepad2,
  "Match ID": Hash,
  ทีม: Users,
  สถานที่: MapPin,
  แพลตฟอร์มสตรีม: Tv,
  Scoreboard: Trophy,
  ลิงก์ประชุม: Video,
  ฟีเจอร์: Sparkles,
  Environment: Server,
  วาระ: ListOrdered,
  โน้ตภายใน: StickyNote,
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  const Icon = DETAIL_ICONS[label];
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <dt className="flex items-start gap-1.5 text-muted-foreground">
        {Icon && <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />}
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">
      {href}
    </a>
  );
}

function ItemDetails({ item }: { item: CalendarItemDetail }) {
  const context: [string, React.ReactNode][] = [
    [
      "เกม",
      item.game && <IconLabel icon={GAME_ICONS[item.game]}>{GAME_LABELS[item.game]}</IconLabel>,
    ],
    ["Match ID", item.matchId],
    ["ทีม", item.teams.length > 0 && item.teams.join(" vs ")],
    ["สถานที่", item.venue],
    ["แพลตฟอร์มสตรีม", item.streamPlatform],
    ["Scoreboard", item.scoreboardUrl && <ExternalLink href={item.scoreboardUrl} />],
    ["ลิงก์ประชุม", item.meetingLink && <ExternalLink href={item.meetingLink} />],
    ["ฟีเจอร์", item.feature],
    ["Environment", item.environment],
  ];
  return (
    <dl className="flex flex-col gap-2">
      <Detail label="เวลา">
        {formatBangkok(item.startAt, "longDay")} {formatRange(item.startAt, item.endAt)}
        <span className="text-muted-foreground"> (เวลาไทย)</span>
      </Detail>
      <Detail label="โหมด">
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <IconLabel icon={MODE_ICONS[item.mode]} iconClassName={MODE_STYLES[item.mode].icon}>
            {MODE_LABELS[item.mode]}
          </IconLabel>
          <IconLabel icon={CATEGORY_ICONS[item.category]}>
            {CATEGORY_LABELS[item.category]}
          </IconLabel>
        </span>
      </Detail>
      <Detail label="สถานะ">
        <IconLabel icon={STATUS_ICONS[item.status]}>{STATUS_LABELS[item.status]}</IconLabel>
      </Detail>
      <Detail label="ผู้รับผิดชอบ">{item.owner?.name ?? "—"}</Detail>
      {item.onCallOwner && <Detail label="On-call">{item.onCallOwner.name}</Detail>}
      {item.scoreboardOperator && (
        <Detail label="คนคุม Scoreboard">{item.scoreboardOperator.name}</Detail>
      )}
      {item.mitigation && (
        <Detail label="แผนรับมือการชน">
          <span className="whitespace-pre-wrap">{item.mitigation}</span>
        </Detail>
      )}
      <Detail label="แหล่งข้อมูล">{item.source}</Detail>
      <Detail label="ยืนยันล่าสุด">
        {item.lastConfirmedAt ? formatBangkok(item.lastConfirmedAt, "dateTime") : "ยังไม่ยืนยัน (TBD)"}
      </Detail>
      <Detail label="การเผยแพร่">
        <IconLabel icon={VISIBILITY_ICONS[item.visibility]}>
          {VISIBILITY_LABELS[item.visibility]}
        </IconLabel>
      </Detail>
      {item.riskLevel && (
        <Detail label="ความเสี่ยง">
          <IconLabel icon={RISK_ICONS[item.riskLevel]}>{RISK_LABELS[item.riskLevel]}</IconLabel>
        </Detail>
      )}
      {item.blockedReason && (
        <Detail label="สิ่งที่ติดขัด">
          <span className="text-destructive">{item.blockedReason}</span>
        </Detail>
      )}
      {context
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Detail key={label} label={label}>
            {value}
          </Detail>
        ))}
      {item.agenda && (
        <Detail label="วาระ">
          <span className="whitespace-pre-wrap">{item.agenda}</span>
        </Detail>
      )}
      {item.notes && (
        <Detail label="โน้ตภายใน">
          <span className="whitespace-pre-wrap">{item.notes}</span>
        </Detail>
      )}
    </dl>
  );
}

type ReasonAction = "cancel";

function Actions({
  item,
  onSelect,
  onEdit,
}: {
  item: CalendarItemDetail;
  onSelect: (id: string) => void;
  onEdit: () => void;
}) {
  const { calendar } = useApis();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<ReasonAction>();
  const [reason, setReason] = useState("");

  const update = useMutation({
    mutationFn: (json: Omit<CalendarUpdate, "version">) =>
      calendar.update(item.id, { ...json, version: item.version }),
    onSuccess: async () => {
      setAsking(undefined);
      setReason("");
      toast.success("บันทึกแล้ว");
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 409
          ? "มีคนแก้ไขรายการนี้ก่อนคุณ ข้อมูลล่าสุดโหลดให้แล้ว"
          : `บันทึกไม่สำเร็จ: ${error.message}`,
        { id: "calendar-update" },
      ),
    onSettled: (_data, error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ["calendar"] });
      }
    },
  });

  const duplicate = useMutation({
    mutationFn: () => calendar.duplicate(item.id),
    onSuccess: async (copy) => {
      toast.success("ทำสำเนาแล้ว (เป็นร่าง)");
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      onSelect(copy.id);
    },
    onError: (error) => toast.error(`ทำสำเนาไม่สำเร็จ: ${error.message}`),
  });

  if (!item.canEdit) return null;
  const pending = update.isPending || duplicate.isPending;
  const operational = item.mode !== "delivery";

  if (asking === "cancel") {
    return (
      <form
        className="flex flex-col gap-2 rounded-xl border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) update.mutate({ status: "cancelled", reason: reason.trim() });
        }}
      >
        <Field>
          <FieldLabel htmlFor="calendar-cancel-reason">เหตุผลที่ยกเลิก</FieldLabel>
          <Textarea
            id="calendar-cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
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
            disabled={!reason.trim() || pending}
          >
            <CalendarX data-icon="inline-start" />
            ยืนยันยกเลิกรายการ
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onEdit} disabled={pending}>
        <Pencil data-icon="inline-start" />
        แก้ไข
      </Button>
      {item.tbd && item.status !== "cancelled" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            update.mutate({
              confirm: true,
              // A draft that has been checked is no longer a draft.
              ...(item.status === "draft" ? { status: "confirmed" as CalendarStatus } : {}),
            })
          }
        >
          <CircleCheck data-icon="inline-start" />
          ยืนยันข้อมูล
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => duplicate.mutate()}>
        <Copy data-icon="inline-start" />
        ทำสำเนา
      </Button>
      {item.canApprove && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending || (item.visibility === "internal" && item.tbd)}
          title={item.tbd ? "รายการ TBD เผยแพร่สาธารณะไม่ได้" : undefined}
          onClick={() =>
            update.mutate({ visibility: item.visibility === "public" ? "internal" : "public" })
          }
        >
          {item.visibility === "public" ? (
            <EyeOff data-icon="inline-start" />
          ) : (
            <Globe data-icon="inline-start" />
          )}
          {item.visibility === "public" ? "เลิกเผยแพร่" : "อนุมัติเผยแพร่สาธารณะ"}
        </Button>
      )}
      {operational && item.status !== "cancelled" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setAsking("cancel")}>
          <CalendarX data-icon="inline-start" />
          ยกเลิกรายการ
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => update.mutate({ archived: item.archivedAt === null })}
      >
        {item.archivedAt === null ? (
          <Archive data-icon="inline-start" />
        ) : (
          <ArchiveRestore data-icon="inline-start" />
        )}
        {item.archivedAt === null ? "เก็บถาวร" : "นำกลับมา"}
      </Button>
    </div>
  );
}

/** The selected item: details, actions and history, or the edit form. */
export function ItemSheet({
  itemId,
  createAt,
  currentUserId,
  canApprove,
  onSelect,
  onClose,
}: {
  itemId: string | null;
  /** Opens the create form, starting at this time. */
  createAt: number | null;
  currentUserId: string;
  canApprove: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { calendar, leadership } = useApis();
  const [editing, setEditing] = useState(false);
  const open = itemId !== null || createAt !== null;

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
  const departmentNames = new Map(departments.data?.map((d) => [d.id, d.name]) ?? []);

  const close = () => {
    setEditing(false);
    onClose();
  };
  const formMode: ItemFormMode | null =
    createAt !== null
      ? { kind: "create", start: createAt }
      : editing && detail.data
        ? { kind: "edit", item: detail.data }
        : null;
  const title =
    createAt !== null
      ? "เพิ่มรายการ"
      : (detail.data?.title ?? (detail.isPending ? "กำลังโหลด" : "รายการ"));

  return (
    <SideDrawer
      open={open}
      onOpenChange={(next) => !next && close()}
      title={
        <span className="flex items-center gap-2">
          {createAt !== null ? (
            <Plus aria-hidden className="size-5 text-primary" />
          ) : (
            detail.data && <CategoryBadge item={detail.data as CalendarItem} />
          )}
          {title}
        </span>
      }
      description={
        detail.data && !formMode ? <ItemFlags item={detail.data as CalendarItem} /> : undefined
      }
    >
      <div className="flex flex-col gap-6">
        {formMode ? (
          <ItemForm
            // A fresh form whenever the item's saved version changes.
            key={formMode.kind === "edit" ? `${formMode.item.id}:${formMode.item.version}` : "new"}
            mode={formMode}
            canApprove={canApprove}
            currentUserId={currentUserId}
            onCancel={() => (createAt !== null ? close() : setEditing(false))}
            onReload={() => void detail.refetch()}
            onDone={(item) => {
              toast.success(createAt !== null ? "เพิ่มรายการแล้ว" : "บันทึกแล้ว");
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
            <Actions item={detail.data} onSelect={onSelect} onEdit={() => setEditing(true)} />
            <ItemDetails item={detail.data} />
            {detail.data.checklist && <ChecklistPanel item={detail.data} />}
            <DeliveryPanel item={detail.data} />
            <CoordinationPanel item={detail.data} />
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
