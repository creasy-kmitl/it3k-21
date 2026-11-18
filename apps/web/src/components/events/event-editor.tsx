import {
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  type EventInput,
  type EventType,
  eventInput,
  eventSlugBase,
} from "@it3k/db/event-rules";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { type RichTextDoc, docFromText, hasContent } from "@it3k/db/rich-text";
import { slugify } from "@it3k/db/slugify";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@it3k/ui/components/combobox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@it3k/ui/components/field";
import { cn } from "@it3k/ui/lib/utils";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  FileText,
  ImageIcon,
  type LucideIcon,
  MapPin,
  Medal,
  School,
  Shapes,
  Ticket,
  Trash2,
  Type,
  Undo2,
  Users,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/calendar/date-time-picker";
import { IconLabel } from "@/components/calendar/icon-label";
import { ChoiceField, ConfirmDelete, FormLabel, FormLegend, TextField } from "@/components/form-dialog";
import { LoadingButton } from "@/components/loading-button";
import { EMPTY_DOC, RichTextEditor } from "@/components/rich-text-editor";
import { ImageUrlField } from "@/components/image-url-field";
import { ShortcutHint } from "@/components/shortcut-hint";
import { SportArt } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/bangkok-time";
import { toastError } from "@/lib/errors";
import type { EventDetail } from "@/lib/events";
import { useMe } from "@/lib/users";
import type { Venue } from "@/lib/venues";
import { DivisionPicker } from "./division-picker";
import { SlugField } from "./slug-field";
import {
  type TicketTypeDraft,
  TicketTypesEditor,
  ticketTypeInputOf,
} from "./ticket-types-editor";

const TYPE_ICONS: Record<EventType, LucideIcon> = {
  sport: Medal,
  general: CalendarDays,
};

export const SAVE_HOTKEY = "Mod+S" as const;

const SECTIONS = [
  { id: "event-basics", label: "ข้อมูลกิจกรรม", icon: Type },
  { id: "event-when", label: "เวลาและสถานที่", icon: CalendarClock },
  { id: "event-content", label: "เนื้อหา", icon: FileText },
  { id: "event-audience", label: "ผู้เข้าร่วม", icon: School, sportOnly: true },
  { id: "event-tickets", label: "ตั๋ว", icon: Ticket },
  { id: "event-danger", label: "ลบกิจกรรม", icon: Trash2 },
] as const;

type FormState = {
  type: EventType;
  name: string;
  slug: string;
  slugTyped: boolean;
  content: RichTextDoc;
  startAt: string;
  endAt: string;
  venueId: string | null;
  thumbnailUrl: string;
  ticketsOpen: boolean;
  ticketCapacity: string;
  institutions: Institution[];
  divisionIds: string[];
  ticketTypes: TicketTypeDraft[];
};

/** The form as loaded from the event. */
export function formStateOf(event: EventDetail): FormState {
  return {
    type: event.type,
    name: event.name,
    slug: event.slug ?? "",
    slugTyped: !!event.slug,
    // Events from before rich text have only a plain description.
    content: event.content ?? (event.description ? docFromText(event.description) : EMPTY_DOC),
    startAt: toDatetimeLocal(Date.parse(event.startAt)),
    endAt: toDatetimeLocal(Date.parse(event.endAt)),
    venueId: event.venue?.id ?? null,
    thumbnailUrl: event.thumbnailUrl ?? "",
    ticketsOpen: event.ticketsOpen,
    ticketCapacity: event.ticketCapacity == null ? "" : String(event.ticketCapacity),
    institutions: event.institutions,
    divisionIds: event.divisions.map((division) => division.id),
    ticketTypes: event.ticketTypes.map((type) => ({
      key: type.id,
      id: type.id,
      name: type.name,
      description: type.description ?? "",
      capacity: type.capacity == null ? "" : String(type.capacity),
      maxPerUser: String(type.maxPerUser),
      open: type.open,
      listedOnly: type.listedOnly,
      allowedRoles: type.allowedRoles,
      allowedInstitutions: type.allowedInstitutions,
      allowedSportIds: type.allowedSportIds,
      ticketCount: type.ticketCount,
    })),
  };
}

/** Every message, keyed by its whole path ("ticketTypes.0.name"). */
export function deepIssuesOf(error: z.ZodError) {
  const issues: Record<string, string> = {};
  for (const issue of error.issues) {
    issues[issue.path.join(".")] ??= issue.message;
  }
  return issues;
}

/** What the form would send, or the problems with it. */
function inputOf(
  form: FormState,
): { input: EventInput; issues?: undefined } | { issues: Record<string, string> } {
  const start = fromDatetimeLocal(form.startAt);
  const end = fromDatetimeLocal(form.endAt);
  if (start === null || end === null) {
    return { issues: { endAt: "เลือกวันและเวลาให้ครบ" } };
  }
  const sport = form.type === "sport";
  const parsed = eventInput.safeParse({
    type: form.type,
    name: form.name,
    // "" has the API make it from the name, adding "-2" if it is taken.
    slug: form.slugTyped ? slugify(form.slug) : "",
    content: hasContent(form.content) ? form.content : null,
    startAt: start,
    endAt: end,
    venueId: form.venueId,
    thumbnailUrl: form.thumbnailUrl,
    ticketsOpen: form.ticketsOpen,
    // Blank is no limit; anything else is checked as a number.
    ticketCapacity: form.ticketCapacity.trim() === "" ? null : Number(form.ticketCapacity),
    // A general event keeps nothing it picked while it was a sport event.
    institutions: sport ? form.institutions : [],
    divisionIds: sport ? form.divisionIds : [],
    ticketTypes: form.ticketTypes.map((type) =>
      // A general event cannot keep "listed athletes only".
      ticketTypeInputOf(sport ? type : { ...type, listedOnly: false }),
    ),
  });
  if (!parsed.success) return { issues: deepIssuesOf(parsed.error) };
  return { input: parsed.data };
}

/**
 * The event's edit tab: a full-page form in sections, with a save bar that
 * appears once something changed (fixed to the bottom on phones). Saving
 * sends the whole event with its version, so an edit made elsewhere since
 * loading is refused instead of overwritten.
 */
export function EventEditor({
  event,
  onDeleted,
}: {
  event: EventDetail;
  onDeleted: () => void;
}) {
  const apis = useApis();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useMe(apis.users);
  const venues = useQuery({ queryKey: ["venues"], queryFn: () => apis.venues.list() });
  const sports = useQuery({ queryKey: ["sports"], queryFn: () => apis.sports.list() });

  const initial = useMemo(() => formStateOf(event), [event]);
  const [form, setForm] = useState(initial);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  // Read by the blocker, which must let our own navigation after a save through.
  const leaving = useRef(false);

  const save = useMutation({
    mutationFn: (input: EventInput) => apis.events.update(event.id, { ...input, version: event.version }),
    onSuccess: async (updated) => {
      toast.success("บันทึกแล้ว");
      const ref = updated.slug ?? updated.id;
      queryClient.setQueryData(["events", ref], { ...updated, canManage: true });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      if (ref !== (event.slug ?? event.id)) {
        leaving.current = true;
        await navigate({
          to: "/staff/events/$eventId",
          params: { eventId: ref },
          search: { tab: "edit" },
          replace: true,
        });
        leaving.current = false;
      }
    },
    onError: (error) => toastError(error, "บันทึกไม่สำเร็จ"),
  });
  const remove = useMutation({
    mutationFn: () => apis.events.remove(event.id),
    onSuccess: async () => {
      toast.success("ลบกิจกรรมแล้ว");
      leaving.current = true;
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      onDeleted();
    },
    onError: (error) => toastError(error, "ลบไม่สำเร็จ"),
  });

  const submit = () => {
    const result = inputOf(form);
    if (result.issues) {
      setIssues(result.issues);
      toast.error("ยังบันทึกไม่ได้ ตรวจช่องที่มีขีดแดง");
      return;
    }
    setIssues({});
    save.mutate(result.input);
  };
  const discard = () => {
    setForm(initial);
    setIssues({});
    setConfirm(null);
  };

  useHotkey(SAVE_HOTKEY, submit, {
    // Saves from inside a text field or the content editor too.
    ignoreInputs: false,
    enabled: dirty && !save.isPending,
  });
  useHotkey("Escape", () => setConfirm("discard"), { enabled: dirty && confirm === null });
  // Leaving with unsaved edits asks first, in our own dialog. Closing or
  // reloading the tab can only use the browser's, which it words itself.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  const sport = form.type === "sport";
  // The art an event without a cover gets: its first picked sport's.
  const coverIcon = (sports.data?.items ?? []).find((item) =>
    item.divisions.some((division) => form.divisionIds.includes(division.id)),
  )?.icon;
  const venueItems = venues.data?.items ?? [];
  const selectedVenue = venueItems.find((venue) => venue.id === form.venueId) ?? null;
  const shownSlug = form.slugTyped
    ? form.slug
    : eventSlugBase({
        name: form.name,
        type: form.type,
        startAt: fromDatetimeLocal(form.startAt) ?? Date.parse(event.startAt),
      });

  return (
    <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
      {/* Wide screens get a table of contents; phones scroll one column. */}
      <nav aria-label="หัวข้อในหน้าแก้ไข" className="hidden lg:block">
        <ul className="sticky top-4 flex flex-col gap-1 text-sm">
          {SECTIONS.filter((section) => !("sportOnly" in section) || sport).map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <section.icon className="size-4" aria-hidden />
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <form
        noValidate
        className={cn("flex min-w-0 flex-col gap-6", dirty && "pb-28 sm:pb-0")}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Section id="event-basics" title="ข้อมูลกิจกรรม" icon={Type}>
          <ChoiceField
            id="event-type"
            label="ประเภทกิจกรรม"
            icon={Shapes}
            value={form.type}
            options={EVENT_TYPES.map((value) => ({
              value,
              label: EVENT_TYPE_LABELS[value],
              icon: TYPE_ICONS[value],
            }))}
            onChange={(type) => set("type", type)}
          />
          {issues.type && <FieldError>{issues.type}</FieldError>}
          <TextField
            id="event-name"
            label="ชื่อกิจกรรม"
            icon={Type}
            value={form.name}
            onChange={(name) => set("name", name)}
            error={issues.name}
          />
          <SlugField
            value={shownSlug}
            typed={form.slugTyped}
            error={issues.slug}
            onChange={(value) => {
              const next = slugify(value, { keepTrailingHyphen: true });
              setForm((current) => ({ ...current, slug: next, slugTyped: next !== "" }));
            }}
            onReset={() => setForm((current) => ({ ...current, slug: "", slugTyped: false }))}
          />
          <ImageUrlField
            id="event-thumbnail"
            label="รูปปก"
            icon={ImageIcon}
            value={form.thumbnailUrl}
            onChange={(url) => set("thumbnailUrl", url)}
            error={issues.thumbnailUrl}
            hint="ไม่ใส่ก็ได้ ระบบจะใช้ภาพประกอบด้านบนแทน"
            selectTitle="เลือกรูปปกกิจกรรม"
            fallback={
              <SportArt
                icon={sport ? (coverIcon ?? "general") : "general"}
                seed={event.id}
                label="ภาพประกอบที่ระบบสร้างให้"
                className="h-full"
              />
            }
          />
        </Section>

        <Section id="event-when" title="เวลาและสถานที่" icon={CalendarClock}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FormLabel htmlFor="event-start" icon={CalendarClock}>
                เริ่ม
              </FormLabel>
              <DateTimePicker
                id="event-start"
                label="เริ่ม"
                value={form.startAt}
                onChange={(value) => set("startAt", value)}
              />
              <FieldDescription>เวลาไทย (UTC+07:00)</FieldDescription>
            </Field>
            <Field data-invalid={!!issues.endAt}>
              <FormLabel htmlFor="event-end" icon={CalendarCheck2}>
                สิ้นสุด
              </FormLabel>
              <DateTimePicker
                id="event-end"
                label="สิ้นสุด"
                value={form.endAt}
                onChange={(value) => set("endAt", value)}
                invalid={!!issues.endAt}
              />
              <FieldError>{issues.endAt}</FieldError>
            </Field>
          </div>
          <Field>
            <FormLabel htmlFor="event-venue" icon={MapPin}>
              สถานที่
            </FormLabel>
            <Combobox<Venue>
              items={venueItems}
              value={selectedVenue}
              itemToStringLabel={(venue) => venue.name}
              itemToStringValue={(venue) => venue.id}
              onValueChange={(venue) => set("venueId", venue?.id ?? null)}
            >
              <ComboboxInput
                id="event-venue"
                placeholder={venues.isPending ? "กำลังโหลดสถานที่" : "ค้นหาสถานที่"}
                triggerLabel="เลือกสถานที่"
                clearLabel="ไม่ระบุสถานที่"
                showClear={!!selectedVenue}
              />
              <ComboboxContent>
                <ComboboxEmpty>ไม่พบสถานที่ เพิ่มได้ที่หน้าสถานที่</ComboboxEmpty>
                <ComboboxList>
                  <ComboboxGroup>
                    <ComboboxCollection>
                      {(venue: Venue) => (
                        <ComboboxItem key={venue.id} value={venue}>
                          <IconLabel icon={MapPin}>{venue.name}</IconLabel>
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Field>
        </Section>

        <Section
          id="event-content"
          title="เนื้อหา"
          icon={FileText}
          description="แสดงในหน้ากิจกรรมของผู้เข้าร่วม ส่วนต้นของเนื้อหาจะเป็นคำอธิบายบนการ์ดและพรีวิวลิงก์"
        >
          <Field data-invalid={!!issues.content}>
            {me.data ? (
              <RichTextEditor
                id="event-content-editor"
                userId={me.data.id}
                value={form.content}
                onChange={(doc) => set("content", doc)}
                label="เนื้อหากิจกรรม"
                placeholder="เล่ารายละเอียดกิจกรรม กำหนดการ สิ่งที่ต้องเตรียม…"
                hint="วางหรือลากรูปมาใส่ได้เลย รูปจะเก็บไว้ในไฟล์ของคุณ ถ้าลบไฟล์ทีหลัง รูปในหน้ากิจกรรมจะหายด้วย"
                imageSelectTitle="เลือกรูปสำหรับหน้ากิจกรรม"
              />
            ) : (
              <div className="min-h-64 animate-pulse rounded-lg border bg-muted/40" />
            )}
            <FieldError>{issues.content}</FieldError>
          </Field>
        </Section>

        {sport && (
          <Section
            id="event-audience"
            title="ผู้เข้าร่วม"
            icon={School}
            description="นักกีฬาที่อนุมัติแล้วในประเภทกีฬาและสถาบันเหล่านี้ คือรายชื่อของกิจกรรม"
          >
            <FieldSet data-invalid={!!issues.institutions}>
              <FormLegend icon={School}>สถาบันที่เข้าร่วม</FormLegend>
              <div className="grid grid-cols-2 gap-2">
                {INSTITUTIONS.map((institution) => (
                  <Field key={institution.id} orientation="horizontal" className="min-h-11 sm:min-h-0">
                    <Checkbox
                      id={`event-institution-${institution.id}`}
                      checked={form.institutions.includes(institution.id)}
                      onCheckedChange={(checked) =>
                        set(
                          "institutions",
                          checked
                            ? [...form.institutions, institution.id]
                            : form.institutions.filter((id) => id !== institution.id),
                        )
                      }
                    />
                    <FieldLabel htmlFor={`event-institution-${institution.id}`}>
                      {institution.short}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              <FieldError>{issues.institutions}</FieldError>
            </FieldSet>
            <DivisionPicker
              sports={sports.data?.items ?? []}
              loading={sports.isPending}
              value={form.divisionIds}
              onChange={(ids) => set("divisionIds", ids)}
              error={issues.divisionIds}
            />
          </Section>
        )}

        <Section
          id="event-tickets"
          title="ตั๋ว"
          icon={Ticket}
          description="ต้องมีตั๋วจึงจะเช็คอินได้ ตั๋วแต่ละใบเช็คอินได้ครั้งเดียว ปิดรับเองเมื่อกิจกรรมจบ"
        >
          <Field orientation="horizontal" className="min-h-11 items-start sm:min-h-0">
            <Checkbox
              id="event-tickets-open"
              checked={form.ticketsOpen}
              onCheckedChange={(checked) => set("ticketsOpen", checked === true)}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <FieldLabel htmlFor="event-tickets-open">เปิดรับตั๋ว</FieldLabel>
              <FieldDescription className="text-xs">
                สวิตช์หลักของทั้งกิจกรรม ปิดไว้ระหว่างเตรียมงาน ผู้เข้าร่วมจะยังไม่เห็นในรายการกิจกรรม
              </FieldDescription>
            </div>
          </Field>
          <TextField
            id="event-ticket-capacity"
            label="จำนวนตั๋วรวมสูงสุด"
            icon={Users}
            inputMode="numeric"
            placeholder="ไม่จำกัด"
            value={form.ticketCapacity}
            onChange={(value) => set("ticketCapacity", value)}
            error={issues.ticketCapacity}
            hint={`รวมทุกประเภท · รับไปแล้ว ${event.ticketCount.toLocaleString("th-TH")} ใบ · เว้นว่างถ้าไม่จำกัด`}
          />
          <TicketTypesEditor
            value={form.ticketTypes}
            onChange={(types) => set("ticketTypes", types)}
            sports={sports.data?.items ?? []}
            sportEvent={sport}
            issues={issues}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />
        </Section>

        <Section id="event-danger" title="ลบกิจกรรม" icon={Trash2} tone="danger">
          <p className="text-sm text-muted-foreground">
            ลบกิจกรรมนี้พร้อมตั๋วและการเช็คอินทั้งหมด ย้อนกลับไม่ได้
          </p>
          <Button
            type="button"
            variant="destructive"
            className="h-11 sm:h-9 sm:self-start"
            onClick={() => setConfirm("delete")}
          >
            <Trash2 data-icon="inline-start" aria-hidden /> ลบกิจกรรม
          </Button>
        </Section>

        {dirty && (
          <section
            aria-label="บันทึกการแก้ไข"
            className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur sm:sticky sm:inset-x-auto sm:bottom-4 sm:rounded-2xl sm:border sm:p-3"
          >
            <div className="flex items-center gap-2">
              <p className="hidden flex-1 text-sm text-muted-foreground sm:block">
                มีการแก้ไขที่ยังไม่ได้บันทึก
              </p>
              <Button
                type="button"
                variant="ghost"
                className="h-11 sm:h-9"
                onClick={() => setConfirm("discard")}
              >
                <Undo2 data-icon="inline-start" aria-hidden />
                ยกเลิก
              </Button>
              <LoadingButton
                type="submit"
                className="h-11 flex-1 sm:h-9 sm:flex-none"
                loading={save.isPending}
              >
                บันทึก
                <ShortcutHint hotkey={SAVE_HOTKEY} />
              </LoadingButton>
            </div>
          </section>
        )}
      </form>

      <AlertDialog open={confirm === "discard"} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยกเลิกการแก้ไข?</AlertDialogTitle>
            <AlertDialogDescription>
              สิ่งที่แก้ไว้ตั้งแต่บันทึกครั้งล่าสุดจะหายไป
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>แก้ไขต่อ</AlertDialogCancel>
            <Button variant="destructive" onClick={discard}>
              ยกเลิกการแก้ไข
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ออกจากหน้านี้โดยไม่บันทึก?</AlertDialogTitle>
            <AlertDialogDescription>
              มีการแก้ไขที่ยังไม่ได้บันทึก ถ้าออกตอนนี้สิ่งที่แก้ไว้จะหายไป
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>อยู่ต่อ</AlertDialogCancel>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              ออกโดยไม่บันทึก
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {confirm === "delete" && (
        <ConfirmDelete
          name={event.name}
          description="ลบกิจกรรมนี้พร้อมตั๋วและการเช็คอินทั้งหมด ย้อนกลับไม่ได้"
          pending={remove.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </div>
  );
}

function Section({
  id,
  title,
  icon: Icon,
  description,
  tone,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  description?: string;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex scroll-mt-4 flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-6",
        tone === "danger" && "border-destructive/40",
      )}
    >
      <header className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold">
          <Icon
            className={cn("size-5 shrink-0", tone === "danger" ? "text-destructive" : "text-primary")}
            aria-hidden
          />
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      <FieldGroup>{children}</FieldGroup>
    </section>
  );
}
