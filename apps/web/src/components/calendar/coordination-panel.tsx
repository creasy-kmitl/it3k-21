import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { useApis } from "@/lib/api-context";
import { formatBangkok, fromDatetimeLocal } from "@/lib/bangkok-time";
import type {
  CalendarActionItem,
  CalendarDepartmentLink,
  CalendarItemDetail,
} from "@/lib/calendar";
import { REQUEST_STATE_LABELS, REQUEST_STATE_STYLES } from "@/lib/calendar-labels";
import { ApiError } from "@/lib/leadership";

const NONE = "__none__";

function failure(error: Error) {
  return error instanceof ApiError && error.status === 409
    ? "มีคนแก้ไขก่อนคุณ โหลดข้อมูลล่าสุดให้แล้ว ลองอีกครั้ง"
    : `บันทึกไม่สำเร็จ: ${error.message}`;
}

/** A mutation that refreshes the calendar afterwards, even when it fails. */
function useCalendarMutation<T>(run: (input: T) => Promise<unknown>, success?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      if (success) toast.success(success);
    },
    onError: (error) => toast.error(failure(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function StateBadge({ state }: { state: CalendarDepartmentLink["state"] }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold",
        REQUEST_STATE_STYLES[state],
      )}
    >
      {REQUEST_STATE_LABELS[state]}
    </span>
  );
}

function RequestForm({
  itemId,
  link,
  onDone,
}: {
  itemId: string;
  link: CalendarDepartmentLink;
  onDone: () => void;
}) {
  const { calendar } = useApis();
  const [request, setRequest] = useState(link.request ?? "");
  const [due, setDue] = useState("");
  const save = useCalendarMutation(
    () =>
      calendar.request(itemId, link.id, {
        request: request.trim() || null,
        ...(due ? { dueAt: fromDatetimeLocal(due) } : {}),
      }),
    "บันทึกคำขอแล้ว",
  );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <Field>
        <FieldLabel htmlFor={`request-${link.id}`}>สิ่งที่ต้องการจาก{link.name}</FieldLabel>
        <Textarea
          id={`request-${link.id}`}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="เว้นว่างเพื่อยกเลิกคำขอ"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`request-due-${link.id}`}>กำหนดส่ง (เวลาไทย)</FieldLabel>
        <Input
          id={`request-due-${link.id}`}
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          ยกเลิก
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          บันทึกคำขอ
        </Button>
      </div>
    </form>
  );
}

function AnswerForm({ itemId, link }: { itemId: string; link: CalendarDepartmentLink }) {
  const { calendar } = useApis();
  const [response, setResponse] = useState(link.response ?? "");
  const save = useCalendarMutation(
    () => calendar.answer(itemId, link.id, response.trim()),
    "ส่งคำตอบแล้ว",
  );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (response.trim()) save.mutate(undefined);
      }}
    >
      <Field>
        <FieldLabel htmlFor={`answer-${link.id}`}>คำตอบจาก{link.name}</FieldLabel>
        <Textarea
          id={`answer-${link.id}`}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        size="sm"
        className="self-end"
        disabled={!response.trim() || save.isPending}
      >
        ส่งคำตอบ
      </Button>
    </form>
  );
}

function DepartmentRequests({ item }: { item: CalendarItemDetail }) {
  const [editing, setEditing] = useState<string>();
  if (item.departments.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่ได้ระบุฝ่ายที่เกี่ยวข้อง</p>;
  }
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {item.departments.map((link) => (
        <li key={link.id} className="flex flex-col gap-2 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{link.name}</span>
            <StateBadge state={link.state} />
            {link.dueAt && (
              <span
                className={cn(
                  "text-xs text-muted-foreground",
                  link.state === "requested" && link.dueAt < Date.now() && "text-destructive",
                )}
              >
                ภายใน {formatBangkok(link.dueAt, "dateTime")}
              </span>
            )}
            {item.canEdit && editing !== link.id && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setEditing(link.id)}
              >
                {link.request ? "แก้คำขอ" : "ขอข้อมูล"}
              </Button>
            )}
          </div>
          {link.request && <p>ขอ: {link.request}</p>}
          {link.contact && (
            <p className="text-xs text-muted-foreground">ผู้ตอบ: {link.contact.name}</p>
          )}
          {link.response && (
            <p className="rounded-lg bg-muted/60 p-2">
              ตอบ: {link.response}
              {link.answeredAt && (
                <span className="block text-xs text-muted-foreground">
                  {formatBangkok(link.answeredAt, "dateTime")}
                </span>
              )}
            </p>
          )}
          {editing === link.id ? (
            <RequestForm itemId={item.id} link={link} onDone={() => setEditing(undefined)} />
          ) : (
            link.canAnswer && <AnswerForm itemId={item.id} link={link} />
          )}
        </li>
      ))}
    </ul>
  );
}

function ActionRow({ action, showSource }: { action: CalendarActionItem; showSource?: boolean }) {
  const { calendar } = useApis();
  const toggle = useCalendarMutation((done: boolean) =>
    calendar.updateActionItem(action.id, { done, version: action.version }),
  );
  const remove = useCalendarMutation(() => calendar.removeActionItem(action.id), "ลบแล้ว");
  const done = action.status === "done";
  const overdue = !done && action.dueAt !== null && action.dueAt < Date.now();
  const id = `action-${action.id}`;
  return (
    <li className="flex items-start gap-2 p-2 text-sm">
      <Checkbox
        id={id}
        checked={done}
        disabled={!action.canComplete || toggle.isPending}
        onCheckedChange={(checked) => toggle.mutate(checked)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col">
        <span className={cn(done && "text-muted-foreground line-through")}>{action.title}</span>
        <span className={cn("text-xs text-muted-foreground", overdue && "text-destructive")}>
          {[
            action.owner?.name,
            action.department?.name,
            action.dueAt && `ภายใน ${formatBangkok(action.dueAt, "dateTime")}`,
            showSource && `จาก ${action.itemTitle}`,
          ]
            .filter(Boolean)
            .join(" · ") || "ยังไม่มีผู้รับผิดชอบ"}
        </span>
      </label>
      {action.canEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`ลบ ${action.title}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined)}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

function AddActionItem({ item }: { item: CalendarItemDetail }) {
  const { calendar, leadership } = useApis();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(NONE);
  const [departmentId, setDepartmentId] = useState(NONE);
  const [due, setDue] = useState("");
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
  const add = useCalendarMutation(
    () =>
      calendar.addActionItem(item.id, {
        title: title.trim(),
        ownerId: ownerId === NONE ? null : ownerId,
        departmentId: departmentId === NONE ? null : departmentId,
        dueAt: due ? fromDatetimeLocal(due) : null,
      }),
    "เพิ่ม action item แล้ว",
  );
  const ownerItems = [
    { value: NONE, label: "ไม่ระบุผู้รับผิดชอบ" },
    ...(people.data?.items.map((p) => ({ value: p.id, label: p.name })) ?? []),
  ];
  const departmentItems = [
    { value: NONE, label: "ไม่ระบุฝ่าย" },
    ...(departments.data?.map((d) => ({ value: d.id, label: d.name })) ?? []),
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    add.mutate(undefined, {
      onSuccess: () => {
        setTitle("");
        setDue("");
      },
    });
  };
  return (
    <form className="flex flex-col gap-2 rounded-xl border border-dashed p-3" onSubmit={submit}>
      <Input
        aria-label="Action item ใหม่"
        placeholder="Action item ใหม่"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={300}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <Select
          items={ownerItems}
          value={ownerId}
          onValueChange={(v: string | null) => setOwnerId(v ?? NONE)}
        >
          <SelectTrigger aria-label="ผู้รับผิดชอบ" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ownerItems.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={departmentItems}
          value={departmentId}
          onValueChange={(v: string | null) => setDepartmentId(v ?? NONE)}
        >
          <SelectTrigger aria-label="ฝ่ายที่รับผิดชอบ" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {departmentItems.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="กำหนดส่ง"
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        className="self-end"
        disabled={!title.trim() || add.isPending}
      >
        เพิ่ม
      </Button>
    </form>
  );
}

function Decisions({ item }: { item: CalendarItemDetail }) {
  const { calendar } = useApis();
  const [text, setText] = useState("");
  const add = useCalendarMutation(() => calendar.addDecision(item.id, text.trim()), "บันทึกแล้ว");
  const remove = useCalendarMutation((id: string) => calendar.removeDecision(id), "ลบแล้ว");
  return (
    <>
      {item.decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีการตัดสินใจ</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-xl border">
          {item.decisions.map((decision) => (
            <li key={decision.id} className="flex items-start gap-2 p-2 text-sm">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="whitespace-pre-wrap">{decision.text}</span>
                <span className="text-xs text-muted-foreground">
                  {[decision.author, formatBangkok(decision.createdAt, "dateTime")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {item.canEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`ลบการตัดสินใจ ${decision.text}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(decision.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {item.canEdit && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate(undefined, { onSuccess: () => setText("") });
          }}
        >
          <Textarea
            aria-label="การตัดสินใจใหม่"
            placeholder="บันทึกสิ่งที่ตกลงกัน"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
          />
          <Button
            type="submit"
            size="sm"
            className="self-end"
            disabled={!text.trim() || add.isPending}
          >
            บันทึกการตัดสินใจ
          </Button>
        </form>
      )}
    </>
  );
}

/** Departments' requests and answers, action items, decisions and carry-overs. */
export function CoordinationPanel({ item }: { item: CalendarItemDetail }) {
  return (
    <div className="flex flex-col gap-6">
      <Section title="ฝ่ายที่เกี่ยวข้อง">
        <DepartmentRequests item={item} />
      </Section>
      {item.carriedOver.length > 0 && (
        <Section title="ค้างจากครั้งก่อน">
          <ul className="flex flex-col divide-y rounded-xl border">
            {item.carriedOver.map((action) => (
              <ActionRow key={action.id} action={action} showSource />
            ))}
          </ul>
        </Section>
      )}
      <Section title="Action items">
        {item.actionItems.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border">
            {item.actionItems.map((action) => (
              <ActionRow key={action.id} action={action} />
            ))}
          </ul>
        )}
        {item.actionItems.length === 0 && !item.canEdit && (
          <p className="text-sm text-muted-foreground">ยังไม่มี action item</p>
        )}
        {item.canEdit && <AddActionItem item={item} />}
      </Section>
      <Section title="การตัดสินใจ">
        <Decisions item={item} />
      </Section>
    </div>
  );
}
