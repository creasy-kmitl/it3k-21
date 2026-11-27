import {
  AUDIENCE_LABELS,
  type EmailAudience,
  type EmailAudienceKind,
  MAX_EMAIL_RECIPIENTS,
  MAX_EMAIL_SUBJECT,
  MAX_MANUAL_RECIPIENTS,
} from "@it3k/db/email-rules";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import {
  REGISTRATION_STATUSES,
  type RegistrationStatus,
  STATUS_LABELS,
} from "@it3k/db/sport-rules";
import { hasContent, type RichTextDoc } from "@it3k/email/rich-text";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import { Input } from "@it3k/ui/components/input";
import { Label } from "@it3k/ui/components/label";
import { Skeleton } from "@it3k/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@it3k/ui/components/table";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarDays,
  Eye,
  History,
  Mail,
  Search,
  Send,
  Trophy,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { IconSelect, type IconSelectItem } from "@/components/icon-select";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { EMPTY_DOC, RichTextEditor } from "@/components/rich-text-editor";
import { SegmentedControl } from "@/components/segmented-control";
import { SportMark } from "@/components/sport-art";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useApis } from "@/lib/api-context";
import {
  type ComposeEmail,
  type EmailAudiences,
  type EmailCampaign,
  type EmailPreview,
  type EmailRecipient,
  EMAILS_KEY,
} from "@/lib/emails";
import { toastError } from "@/lib/errors";
import { ApiError } from "@/lib/leadership";
import { useMe } from "@/lib/users";

export const Route = createFileRoute("/staff/email")({
  component: EmailPage,
});

const institutionName = (id: string) =>
  INSTITUTIONS.find((institution) => institution.id === id)?.short ?? id;

/** What the audience picker holds; only the fields of the chosen kind are sent. */
type AudienceDraft = {
  kind: EmailAudienceKind;
  institutions: Institution[];
  sportId: string | null;
  divisionIds: string[];
  statuses: RegistrationStatus[];
  eventId: string | null;
  people: EmailRecipient[];
  emails: string;
};

const EMPTY_AUDIENCE: AudienceDraft = {
  kind: "participants",
  institutions: [],
  sportId: null,
  divisionIds: [],
  statuses: ["approved"],
  eventId: null,
  people: [],
  emails: "",
};

const emailAddress = z.email();

/** Splits typed addresses on commas, semicolons and whitespace. */
export function parseEmails(raw: string) {
  const all = [...new Set(raw.split(/[\s,;]+/).filter(Boolean))];
  return {
    valid: all.filter((value) => emailAddress.safeParse(value).success),
    invalid: all.filter((value) => !emailAddress.safeParse(value).success),
  };
}

/** The audience to send, or the reason it cannot be sent yet. */
export function toAudience(draft: AudienceDraft): EmailAudience | { error: string } {
  switch (draft.kind) {
    case "participants":
      return { kind: "participants", institutions: draft.institutions };
    case "athletes":
      if (!draft.statuses.length) return { error: "เลือกสถานะการสมัครอย่างน้อยหนึ่งแบบ" };
      return {
        kind: "athletes",
        sportId: draft.sportId,
        divisionIds: draft.sportId ? draft.divisionIds : [],
        statuses: draft.statuses,
        institutions: draft.institutions,
      };
    case "ticket-holders":
      if (!draft.eventId) return { error: "เลือกกิจกรรม" };
      return { kind: "ticket-holders", eventId: draft.eventId, institutions: draft.institutions };
    case "manual": {
      const { valid, invalid } = parseEmails(draft.emails);
      if (invalid.length) return { error: `อีเมลไม่ถูกต้อง: ${invalid.slice(0, 3).join(", ")}` };
      if (!draft.people.length && !valid.length) return { error: "เพิ่มผู้รับอย่างน้อยหนึ่งคน" };
      if (draft.people.length + valid.length > MAX_MANUAL_RECIPIENTS)
        return { error: `ระบุผู้รับได้ไม่เกิน ${MAX_MANUAL_RECIPIENTS} คน` };
      return { kind: "manual", userIds: draft.people.map((person) => person.id), emails: valid };
    }
  }
}

/** A row of on/off pills. Nothing chosen means "all", which `allLabel` says. */
function TogglePills<T extends string>({
  label,
  options,
  value,
  onChange,
  allLabel,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
  allLabel?: string;
}) {
  return (
    <fieldset aria-label={label} className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
      {allLabel && (
        <PillButton pressed={value.length === 0} onClick={() => onChange([])}>
          {allLabel}
        </PillButton>
      )}
      {options.map((option) => {
        const pressed = value.includes(option.value);
        return (
          <PillButton
            key={option.value}
            pressed={pressed}
            onClick={() =>
              onChange(
                pressed ? value.filter((item) => item !== option.value) : [...value, option.value],
              )
            }
          >
            {option.label}
          </PillButton>
        );
      })}
    </fieldset>
  );
}

function PillButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-8 rounded-4xl border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {htmlFor ? (
        <Label htmlFor={htmlFor}>{label}</Label>
      ) : (
        <span className="text-sm font-medium">{label}</span>
      )}
      {children}
    </div>
  );
}

function PeoplePicker({
  people,
  onChange,
}: {
  people: EmailRecipient[];
  onChange: (people: EmailRecipient[]) => void;
}) {
  const { emails } = useApis();
  const [q, setQ] = useState("");
  const search = useDebouncedValue(q.trim());
  const results = useQuery({
    queryKey: [...EMAILS_KEY, "recipients", search],
    queryFn: () => emails.recipients(search),
    enabled: search.length > 0,
  });
  const chosen = new Set(people.map((person) => person.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="ค้นหาชื่อหรืออีเมล"
          aria-label="ค้นหาผู้รับ"
          className="pl-9"
        />
      </div>
      {search && (
        <ul
          className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-lg border"
          aria-label="ผลการค้นหา"
        >
          {results.isPending && (
            <li className="px-3 py-2 text-sm text-muted-foreground">กำลังค้นหา…</li>
          )}
          {results.isError && <li className="px-3 py-2 text-sm text-destructive">ค้นหาไม่สำเร็จ</li>}
          {results.data?.items.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">ไม่พบผู้ใช้</li>
          )}
          {results.data?.items.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{person.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {person.email}
                  {person.institution && ` · ${institutionName(person.institution)}`}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={chosen.has(person.id)}
                onClick={() => onChange([...people, person])}
              >
                <UserPlus data-icon="inline-start" aria-hidden />
                {chosen.has(person.id) ? "เพิ่มแล้ว" : "เพิ่ม"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {people.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="ผู้รับที่เลือก">
          {people.map((person) => (
            <li key={person.id}>
              <Badge variant="secondary" className="h-7 gap-1 pr-1">
                {person.name}
                <button
                  type="button"
                  aria-label={`เอา ${person.name} ออก`}
                  className="rounded-full p-0.5 hover:bg-background"
                  onClick={() => onChange(people.filter((item) => item.id !== person.id))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AudiencePicker({
  options,
  value,
  onChange,
}: {
  options: EmailAudiences;
  value: AudienceDraft;
  onChange: (value: AudienceDraft) => void;
}) {
  const set = (patch: Partial<AudienceDraft>) => onChange({ ...value, ...patch });
  const sport = options.sports.find((item) => item.id === value.sportId);
  const sportItems: IconSelectItem<string>[] = [
    { value: null, label: "ทุกกีฬา", icon: <Trophy aria-hidden className="text-muted-foreground" /> },
    ...options.sports.map((item) => ({
      value: item.id,
      label: item.name,
      icon: <SportMark icon={item.icon} seed={item.id} />,
    })),
  ];
  // Newest first from the server; upcoming ones are the likely audience.
  const now = Date.now();
  const eventItems: IconSelectItem<string>[] = options.events.map((item) => ({
    value: item.id,
    label: item.name,
    icon: <CalendarDays aria-hidden className="text-muted-foreground" />,
    group: Date.parse(item.startAt) >= now ? "กำลังจะมาถึง" : "ผ่านไปแล้ว",
  }));

  const institutions =
    value.kind === "manual" ? null : (
      <Row label="สถาบัน">
        <TogglePills
          label="สถาบัน"
          allLabel="ทุกสถาบัน"
          options={options.institutions.map((id) => ({ value: id, label: institutionName(id) }))}
          value={value.institutions}
          onChange={(next) => set({ institutions: next })}
        />
      </Row>
    );

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label="กลุ่มผู้รับ"
        className="self-start overflow-x-auto"
        segments={(Object.keys(AUDIENCE_LABELS) as EmailAudienceKind[]).map((kind) => ({
          value: kind,
          label: AUDIENCE_LABELS[kind],
        }))}
        value={value.kind}
        onChange={(kind) => set({ kind })}
      />

      {value.kind === "participants" && (
        <p className="text-sm text-muted-foreground">ทุกคนที่ส่งข้อมูลลงทะเบียนแล้ว</p>
      )}

      {value.kind === "athletes" && (
        <>
          <Row label="กีฬา">
            <IconSelect
              label="กีฬา"
              items={sportItems}
              value={value.sportId}
              onChange={(next) => set({ sportId: next, divisionIds: [] })}
              className="sm:w-64"
            />
          </Row>
          {sport && sport.divisions.length > 0 && (
            <Row label="ประเภท">
              <TogglePills
                label="ประเภท"
                allLabel="ทุกประเภท"
                options={sport.divisions.map((division) => ({
                  value: division.id,
                  label: division.name,
                }))}
                value={value.divisionIds}
                onChange={(next) => set({ divisionIds: next })}
              />
            </Row>
          )}
          <Row label="สถานะการสมัคร">
            <TogglePills
              label="สถานะการสมัคร"
              options={REGISTRATION_STATUSES.map((status) => ({
                value: status,
                label: STATUS_LABELS[status],
              }))}
              value={value.statuses}
              onChange={(next) => set({ statuses: next })}
            />
          </Row>
        </>
      )}

      {value.kind === "ticket-holders" && (
        <Row label="กิจกรรม">
          {eventItems.length ? (
            <IconSelect
              label="กิจกรรม"
              placeholder="เลือกกิจกรรม"
              items={eventItems}
              value={value.eventId}
              onChange={(next) => set({ eventId: next })}
              className="sm:w-80"
            />
          ) : (
            <p className="text-sm text-muted-foreground">ยังไม่มีกิจกรรม</p>
          )}
        </Row>
      )}

      {value.kind === "manual" && (
        <>
          <Row label="ผู้ใช้ในระบบ">
            <PeoplePicker people={value.people} onChange={(people) => set({ people })} />
          </Row>
          <Row label="อีเมลอื่น" htmlFor="email-extra">
            <Textarea
              id="email-extra"
              value={value.emails}
              onChange={(event) => set({ emails: event.target.value })}
              placeholder="คั่นแต่ละอีเมลด้วยจุลภาคหรือขึ้นบรรทัดใหม่"
              rows={3}
            />
          </Row>
        </>
      )}

      {institutions}
    </div>
  );
}

function PreviewDialog({
  preview,
  sending,
  onSend,
  onClose,
}: {
  preview: EmailPreview;
  sending: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const count = preview.recipientCount;
  const blocked = count === 0 || preview.tooMany;

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>ตัวอย่างอีเมล</DialogTitle>
          <DialogDescription>
            {count === 0
              ? "ไม่มีผู้รับที่ตรงกับเงื่อนไข"
              : preview.tooMany
                ? `ผู้รับ ${count.toLocaleString("th-TH")} คน เกินกว่าที่ส่งได้ครั้งละ ${MAX_EMAIL_RECIPIENTS.toLocaleString("th-TH")} คน แบ่งกลุ่มให้เล็กลง`
                : `จะส่งถึง ${count.toLocaleString("th-TH")} คน`}
          </DialogDescription>
        </DialogHeader>
        <iframe
          title="ตัวอย่างอีเมล"
          srcDoc={preview.html}
          // No allow-scripts, so the email cannot run code; same-origin only lets it paint.
          sandbox="allow-same-origin"
          className="min-h-96 w-full flex-1 rounded-lg border bg-white"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            กลับไปแก้ไข
          </Button>
          <Button onClick={() => setConfirm(true)} disabled={blocked || sending}>
            <Send data-icon="inline-start" aria-hidden />
            ส่งอีเมล
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirm} onOpenChange={(open) => !sending && setConfirm(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ส่งถึง {count.toLocaleString("th-TH")} คน?</AlertDialogTitle>
            <AlertDialogDescription>ส่งแล้วยกเลิกไม่ได้</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>ยกเลิก</AlertDialogCancel>
            <LoadingButton loading={sending} icon={Send} onClick={onSend}>
              ส่งเลย
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

const dateFormat = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

function HistoryTable() {
  const { emails } = useApis();
  const history = useQuery({
    queryKey: [...EMAILS_KEY, "history"],
    queryFn: () => emails.history(),
    // Keep the counts moving while the queue is still sending something.
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) => item.sentCount + item.failedCount < item.recipientCount,
      )
        ? 5000
        : false,
  });

  if (history.isPending) return <Skeleton className="h-32 w-full" />;
  if (history.isError)
    return (
      <ErrorState
        error={history.error}
        onRetry={history.refetch}
        title="โหลดประวัติไม่สำเร็จ"
        size="sm"
      />
    );
  if (!history.data.items.length)
    return <p className="text-sm text-muted-foreground">ยังไม่เคยส่งอีเมล</p>;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>หัวเรื่อง</TableHead>
            <TableHead>กลุ่ม</TableHead>
            <TableHead className="text-right">ส่งแล้ว</TableHead>
            <TableHead>ผู้ส่ง</TableHead>
            <TableHead>เวลา</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.data.items.map((item: EmailCampaign) => (
            <TableRow key={item.id}>
              <TableCell className="max-w-72 truncate font-medium">{item.subject}</TableCell>
              <TableCell>
                {AUDIENCE_LABELS[item.audienceKind as EmailAudienceKind] ?? item.audienceKind}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.sentCount.toLocaleString("th-TH")}/
                {item.recipientCount.toLocaleString("th-TH")}
                {item.failedCount > 0 && (
                  <span className="ml-1 text-destructive">(ไม่สำเร็จ {item.failedCount})</span>
                )}
              </TableCell>
              <TableCell>{item.senderName}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {dateFormat.format(new Date(item.createdAt))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Staff write an email with rich text and images and send it to a group of
 * people. The page asks for a preview, with the real recipient count, before
 * anything is sent. The API decides who the sender may reach.
 */
export function EmailPage() {
  const apis = useApis();
  const queryClient = useQueryClient();
  const me = useMe(apis.users);
  const allowed = !!me.data?.canSendEmail;
  const audiences = useQuery({
    queryKey: [...EMAILS_KEY, "audiences"],
    queryFn: () => apis.emails.audiences(),
    enabled: allowed,
  });
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState<RichTextDoc>(EMPTY_DOC);
  const [audience, setAudience] = useState<AudienceDraft>(EMPTY_AUDIENCE);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const compose = (): { json: ComposeEmail } | { error: string } => {
    const target = toAudience(audience);
    if (!subject.trim()) return { error: "กรอกหัวเรื่อง" };
    if (!hasContent(content)) return { error: "เขียนเนื้อหาอีเมล" };
    if ("error" in target) return target;
    return { json: { subject: subject.trim(), content, audience: target } };
  };

  const previewMutation = useMutation({
    mutationFn: (json: ComposeEmail) => apis.emails.preview(json),
    onSuccess: setPreview,
    onError: (error) => toastError(error, "ดูตัวอย่างไม่สำเร็จ"),
  });
  const send = useMutation({
    mutationFn: (json: ComposeEmail) => apis.emails.send(json),
    onSuccess: (result) => {
      toast.success(`กำลังส่งอีเมลถึง ${result.recipientCount.toLocaleString("th-TH")} คน`);
      setPreview(null);
      setSubject("");
      setContent(EMPTY_DOC);
      void queryClient.invalidateQueries({ queryKey: [...EMAILS_KEY, "history"] });
    },
    onError: (error) => toastError(error, "ส่งอีเมลไม่สำเร็จ"),
  });

  const header = (
    <PageHeader
      icon={Mail}
      title="ส่งอีเมล"
      description="เขียนอีเมลพร้อมรูป แล้วส่งถึงผู้เข้าร่วม นักกีฬา หรือผู้ถือตั๋ว"
    />
  );

  if (me.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (me.isError || !allowed) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState
          error={me.error ?? new ApiError(403, "คุณไม่มีสิทธิ์ส่งอีเมล")}
          onRetry={me.isError ? me.refetch : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}
      <section
        className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-6"
        aria-label="เขียนอีเมล"
      >
        <Row label="หัวเรื่อง" htmlFor="email-subject">
          <Input
            id="email-subject"
            value={subject}
            maxLength={MAX_EMAIL_SUBJECT}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="เช่น แจ้งกำหนดการรายงานตัวนักกีฬา"
          />
        </Row>

        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" aria-hidden />
            ผู้รับ
          </span>
          {audiences.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : audiences.isError ? (
            <ErrorState
              error={audiences.error}
              onRetry={audiences.refetch}
              size="sm"
              title="โหลดกลุ่มผู้รับไม่สำเร็จ"
            />
          ) : (
            <AudiencePicker options={audiences.data} value={audience} onChange={setAudience} />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">เนื้อหา</span>
          <RichTextEditor userId={me.data.id} value={content} onChange={setContent} />
        </div>

        {problem && (
          <p className="text-sm text-destructive" role="alert">
            {problem}
          </p>
        )}
        <div className="flex justify-end">
          <LoadingButton
            loading={previewMutation.isPending}
            icon={Eye}
            disabled={!audiences.data}
            onClick={() => {
              const result = compose();
              if ("error" in result) {
                setProblem(result.error);
                return;
              }
              setProblem(null);
              previewMutation.mutate(result.json);
            }}
          >
            ดูตัวอย่างและส่ง
          </LoadingButton>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label="ประวัติการส่ง">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <History className="size-5 text-primary" aria-hidden />
          ประวัติการส่ง
        </h2>
        <HistoryTable />
      </section>

      {preview && (
        <PreviewDialog
          preview={preview}
          sending={send.isPending}
          onClose={() => setPreview(null)}
          onSend={() => {
            const result = compose();
            if ("error" in result) {
              setPreview(null);
              setProblem(result.error);
              return;
            }
            send.mutate(result.json);
          }}
        />
      )}
    </div>
  );
}
