import type { CalendarStatus } from "@it3k/db/calendar-rules";
import { Button } from "@it3k/ui/components/button";
import { Field, FieldLabel } from "@it3k/ui/components/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@it3k/ui/components/sheet";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useApis } from "@/lib/api-context";
import { formatBangkok, formatRange } from "@/lib/bangkok-time";
import type {
  CalendarChange,
  CalendarItem,
  CalendarItemDetail,
  CalendarUpdate,
} from "@/lib/calendar";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  FIELD_LABELS,
  GAME_LABELS,
  MODE_LABELS,
  RISK_LABELS,
  STATUS_LABELS,
  VISIBILITY_LABELS,
} from "@/lib/calendar-labels";
import { ApiError } from "@/lib/leadership";

import { ItemFlags } from "./item-chip";
import { ItemForm, type ItemFormMode } from "./item-form";

const TIME_FIELDS = new Set(["startAt", "endAt", "lastConfirmedAt", "archivedAt", "approvedAt"]);
const LABELLED: Record<string, Record<string, string>> = {
  status: STATUS_LABELS,
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
        <li key={change.id} className="border-l-2 pl-3 text-xs">
          <p className="font-medium">
            {ACTION_LABELS[change.action]} · {change.actorName ?? "ผู้ใช้ที่ถูกลบ"}
          </p>
          <p className="text-muted-foreground">{formatBangkok(change.createdAt, "dateTime")}</p>
          {change.reason && <p className="mt-1">เหตุผล: {change.reason}</p>}
          {change.action !== "create" && (
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {Object.entries(change.changes).map(([field, pair]) => {
                const [before, after] = pair as [unknown, unknown];
                return (
                  <li key={field}>
                    {FIELD_LABELS[field] ?? field}: {describeValue(field, before, departmentNames)}{" "}
                    → {describeValue(field, after, departmentNames)}
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
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
    ["เกม", item.game && GAME_LABELS[item.game]],
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
        {MODE_LABELS[item.mode]} · {CATEGORY_LABELS[item.category]}
      </Detail>
      <Detail label="สถานะ">{STATUS_LABELS[item.status]}</Detail>
      <Detail label="ผู้รับผิดชอบ">{item.owner?.name ?? "—"}</Detail>
      <Detail label="แหล่งข้อมูล">{item.source}</Detail>
      <Detail label="ยืนยันล่าสุด">
        {item.lastConfirmedAt ? formatBangkok(item.lastConfirmedAt, "dateTime") : "ยังไม่ยืนยัน (TBD)"}
      </Detail>
      <Detail label="การเผยแพร่">{VISIBILITY_LABELS[item.visibility]}</Detail>
      <Detail label="ฝ่ายที่เกี่ยวข้อง">
        {item.departments.length ? item.departments.map((d) => d.name).join(", ") : "—"}
      </Detail>
      {item.riskLevel && <Detail label="ความเสี่ยง">{RISK_LABELS[item.riskLevel]}</Detail>}
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
            ยืนยันยกเลิกรายการ
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onEdit} disabled={pending}>
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
          ยืนยันข้อมูล
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => duplicate.mutate()}>
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
          {item.visibility === "public" ? "เลิกเผยแพร่" : "อนุมัติเผยแพร่สาธารณะ"}
        </Button>
      )}
      {operational && item.status !== "cancelled" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setAsking("cancel")}>
          ยกเลิกรายการ
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => update.mutate({ archived: item.archivedAt === null })}
      >
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
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {detail.data && !formMode && (
            <SheetDescription render={<div />}>
              <ItemFlags item={detail.data as CalendarItem} />
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          {formMode ? (
            <ItemForm
              // A fresh form whenever the item's saved version changes.
              key={
                formMode.kind === "edit" ? `${formMode.item.id}:${formMode.item.version}` : "new"
              }
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
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">ประวัติการเปลี่ยนแปลง</h3>
                <ChangeLog changes={detail.data.changes} departmentNames={departmentNames} />
              </section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
