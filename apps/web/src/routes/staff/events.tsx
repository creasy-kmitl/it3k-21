import {
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  type EventInput,
  type EventType,
  eventInput,
} from "@it3k/db/event-rules";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import type { SportIcon } from "@it3k/db/sport-rules";
import { Badge } from "@it3k/ui/components/badge";
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
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@it3k/ui/components/field";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck, Clock, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/calendar/date-time-picker";
import {
  ChoiceField,
  ConfirmDelete,
  FormDialog,
  TextField,
  issuesOf,
} from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import {
  HOUR_MS,
  formatBangkok,
  formatRange,
  fromDatetimeLocal,
  startOfDay,
  toDatetimeLocal,
} from "@/lib/bangkok-time";
import type { EventItem } from "@/lib/events";
import type { Sport } from "@/lib/sports";
import type { Venue } from "@/lib/venues";

export const Route = createFileRoute("/staff/events")({
  component: EventsPage,
});

const institutionShort = (id: Institution) =>
  INSTITUTIONS.find((item) => item.id === id)?.short ?? id;

/** The illustration for an event without a thumbnail: its first sport's. */
export function eventIcon(event: Pick<EventItem, "divisions">): SportIcon {
  return event.divisions[0]?.icon ?? "general";
}

export function eventTime(event: Pick<EventItem, "startAt" | "endAt">) {
  const start = Date.parse(event.startAt);
  return `${formatBangkok(start, "date")} ${formatRange(start, Date.parse(event.endAt))}`;
}

/** Division names grouped by sport, e.g. "กีฬาฟุตบอล: ฟุตบอล". */
function sportsSummary(event: EventItem) {
  const bySport = new Map<string, string[]>();
  for (const division of event.divisions) {
    bySport.set(division.sportName, [...(bySport.get(division.sportName) ?? []), division.name]);
  }
  return [...bySport].map(([sport, names]) => `${sport}: ${names.join(", ")}`);
}

type Editing = { kind: "event"; event: EventItem | null } | { kind: "delete"; event: EventItem };

/** Sport and general events. The API enforces who may edit. */
export function EventsPage() {
  const { events: api } = useApis();
  const queryClient = useQueryClient();
  const [showPast, setShowPast] = useState(false);
  // Fixed for the visit, so the query key does not change every render.
  const [today] = useState(() => startOfDay(Date.now()));
  const events = useQuery({
    queryKey: ["events", { showPast }],
    queryFn: () => api.list(showPast ? {} : { endsAfter: today }),
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const canManage = events.data?.canManage ?? false;

  const save = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      toast.success("บันทึกแล้ว");
      setEditing(null);
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader icon={CalendarCheck} title="กิจกรรม" description="การแข่งขันกีฬาและกิจกรรมทั่วไป" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowPast((value) => !value)}>
            {showPast ? "เฉพาะที่ยังไม่จบ" : "แสดงที่จบแล้ว"}
          </Button>
          {canManage && (
            <Button onClick={() => setEditing({ kind: "event", event: null })}>
              <Plus /> เพิ่มกิจกรรม
            </Button>
          )}
        </div>
      </div>

      {events.isPending ? (
        <div role="status" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : events.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p>โหลดกิจกรรมไม่สำเร็จ: {events.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void events.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : events.data.items.length === 0 ? (
        <p className="text-muted-foreground">{showPast ? "ยังไม่มีกิจกรรม" : "ไม่มีกิจกรรมที่กำลังจะมาถึง"}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {events.data.items.map((event) => (
            <li key={event.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
              <SportThumbnail
                src={event.thumbnailUrl}
                icon={eventIcon(event)}
                seed={event.id}
                label={event.name}
              />
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start gap-2">
                  <h2 className="flex-1 font-semibold">{event.name}</h2>
                  <Badge variant={event.type === "sport" ? "default" : "secondary"}>
                    {EVENT_TYPE_LABELS[event.type]}
                  </Badge>
                </div>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="size-4 shrink-0" aria-hidden />
                  {eventTime(event)}
                </p>
                {event.venue && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="size-4 shrink-0" aria-hidden />
                    {event.venue.name}
                  </p>
                )}
                {event.description && (
                  <p className="text-sm whitespace-pre-wrap">{event.description}</p>
                )}
                {event.institutions.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {event.institutions.map((institution) => (
                      <Badge key={institution} variant="outline">
                        {institutionShort(institution)}
                      </Badge>
                    ))}
                  </span>
                )}
                {sportsSummary(event).map((line) => (
                  <p key={line} className="text-sm text-muted-foreground">
                    {line}
                  </p>
                ))}
              </div>
              {canManage && (
                <div className="flex justify-end border-t p-2">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`แก้ไข ${event.name}`}
                    onClick={() => setEditing({ kind: "event", event })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`ลบ ${event.name}`}
                    onClick={() => setEditing({ kind: "delete", event })}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing?.kind === "event" && (
        <EventForm
          key={editing.event?.id ?? "new"}
          initial={editing.event}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            const { event } = editing;
            save.mutate(() =>
              event
                ? api.update(event.id, { ...input, version: event.version })
                : api.create(input),
            );
          }}
        />
      )}
      {editing?.kind === "delete" && (
        <ConfirmDelete
          name={editing.event.name}
          description="ลบกิจกรรมนี้ออกจากระบบ"
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onConfirm={() => save.mutate(() => api.remove(editing.event.id))}
        />
      )}
    </div>
  );
}

function nextHour() {
  return Math.ceil(Date.now() / HOUR_MS) * HOUR_MS;
}

export function EventForm({
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  initial: EventItem | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: EventInput) => void;
}) {
  const { venues: venuesApi, sports: sportsApi } = useApis();
  const venues = useQuery({ queryKey: ["venues"], queryFn: () => venuesApi.list() });
  const sports = useQuery({ queryKey: ["sports"], queryFn: () => sportsApi.list() });

  const start = initial ? Date.parse(initial.startAt) : nextHour();
  const [type, setType] = useState<EventType>(initial?.type ?? "sport");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [startAt, setStartAt] = useState(toDatetimeLocal(start));
  const [endAt, setEndAt] = useState(
    toDatetimeLocal(initial ? Date.parse(initial.endAt) : start + 2 * HOUR_MS),
  );
  const [venueId, setVenueId] = useState<string | null>(initial?.venue?.id ?? null);
  const [thumbnailUrl, setThumbnailUrl] = useState(initial?.thumbnailUrl ?? "");
  const [institutions, setInstitutions] = useState<Institution[]>(initial?.institutions ?? []);
  const [divisionIds, setDivisionIds] = useState<string[]>(
    initial?.divisions.map((division) => division.id) ?? [],
  );
  const [issues, setIssues] = useState<Record<string, string>>({});

  const venueItems = venues.data?.items ?? [];
  const selectedVenue = venueItems.find((venue) => venue.id === venueId) ?? null;

  return (
    <FormDialog
      title={initial ? `แก้ไข ${initial.name}` : "เพิ่มกิจกรรม"}
      pending={pending}
      onClose={onClose}
      onSubmit={() => {
        const start = fromDatetimeLocal(startAt);
        const end = fromDatetimeLocal(endAt);
        if (start === null || end === null) {
          setIssues({ endAt: "เลือกวันและเวลาให้ครบ" });
          return;
        }
        const sport = type === "sport";
        const parsed = eventInput.safeParse({
          type,
          name,
          description,
          startAt: start,
          endAt: end,
          venueId,
          thumbnailUrl,
          // A general event keeps nothing it picked while it was a sport event.
          institutions: sport ? institutions : [],
          divisionIds: sport ? divisionIds : [],
        });
        if (!parsed.success) {
          setIssues(issuesOf(parsed.error));
          return;
        }
        setIssues({});
        onSubmit(parsed.data);
      }}
    >
      <ChoiceField
        id="event-type"
        label="ประเภทกิจกรรม"
        value={type}
        options={EVENT_TYPES.map((value) => ({ value, label: EVENT_TYPE_LABELS[value] }))}
        onChange={setType}
      />
      <TextField
        id="event-name"
        label="ชื่อกิจกรรม"
        value={name}
        onChange={setName}
        error={issues.name}
      />
      <Field data-invalid={!!issues.description}>
        <FieldLabel htmlFor="event-description">รายละเอียด</FieldLabel>
        <Textarea
          id="event-description"
          value={description}
          aria-invalid={!!issues.description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {issues.description && <FieldDescription>{issues.description}</FieldDescription>}
      </Field>
      <Field>
        <FieldLabel htmlFor="event-start">เริ่ม</FieldLabel>
        <DateTimePicker id="event-start" label="เริ่ม" value={startAt} onChange={setStartAt} />
      </Field>
      <Field data-invalid={!!issues.endAt}>
        <FieldLabel htmlFor="event-end">สิ้นสุด</FieldLabel>
        <DateTimePicker
          id="event-end"
          label="สิ้นสุด"
          value={endAt}
          onChange={setEndAt}
          invalid={!!issues.endAt}
        />
        {issues.endAt && <FieldDescription>{issues.endAt}</FieldDescription>}
      </Field>
      <Field>
        <FieldLabel htmlFor="event-venue">สถานที่</FieldLabel>
        <Combobox<Venue>
          items={venueItems}
          value={selectedVenue}
          itemToStringLabel={(venue) => venue.name}
          itemToStringValue={(venue) => venue.id}
          onValueChange={(venue) => setVenueId(venue?.id ?? null)}
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
                      {venue.name}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
      <TextField
        id="event-thumbnail"
        label="ลิงก์รูปปก"
        inputMode="url"
        placeholder="https://..."
        value={thumbnailUrl}
        onChange={setThumbnailUrl}
        error={issues.thumbnailUrl}
        hint="ไม่ใส่ก็ได้ ระบบจะสร้างภาพประกอบให้"
      />
      {type === "sport" && (
        <>
          <FieldSet data-invalid={!!issues.institutions}>
            <FieldLegend variant="label">สถาบันที่เข้าร่วม</FieldLegend>
            <div className="grid gap-2 sm:grid-cols-2">
              {INSTITUTIONS.map((institution) => (
                <Field key={institution.id} orientation="horizontal">
                  <Checkbox
                    id={`event-institution-${institution.id}`}
                    checked={institutions.includes(institution.id)}
                    onCheckedChange={(checked) =>
                      setInstitutions((current) =>
                        checked
                          ? [...current, institution.id]
                          : current.filter((id) => id !== institution.id),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`event-institution-${institution.id}`}>
                    {institution.short}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            {issues.institutions && <FieldDescription>{issues.institutions}</FieldDescription>}
          </FieldSet>
          <DivisionPicker
            sports={sports.data?.items ?? []}
            loading={sports.isPending}
            value={divisionIds}
            onChange={setDivisionIds}
            error={issues.divisionIds}
          />
        </>
      )}
    </FormDialog>
  );
}

/** Divisions grouped by sport; a sport's own box picks or drops all of them. */
function DivisionPicker({
  sports,
  loading,
  value,
  onChange,
  error,
}: {
  sports: Sport[];
  loading: boolean;
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}) {
  const picked = new Set(value);
  return (
    <FieldSet data-invalid={!!error}>
      <FieldLegend variant="label">ประเภทกีฬา</FieldLegend>
      {loading && <Skeleton className="h-24" />}
      <div className="flex flex-col gap-3">
        {sports
          .filter((sport) => sport.divisions.length > 0)
          .map((sport) => {
            const ids = sport.divisions.map((division) => division.id);
            const count = ids.filter((id) => picked.has(id)).length;
            return (
              <div key={sport.id} className="flex flex-col gap-2 rounded-xl border p-3">
                <Field orientation="horizontal">
                  <Checkbox
                    id={`event-sport-${sport.id}`}
                    checked={count === ids.length}
                    indeterminate={count > 0 && count < ids.length}
                    onCheckedChange={(checked) =>
                      onChange(
                        checked
                          ? [...value, ...ids.filter((id) => !picked.has(id))]
                          : value.filter((id) => !ids.includes(id)),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`event-sport-${sport.id}`} className="font-medium">
                    {sport.name}
                  </FieldLabel>
                </Field>
                <div className="grid gap-2 pl-6 sm:grid-cols-2">
                  {sport.divisions.map((division) => (
                    <Field key={division.id} orientation="horizontal">
                      <Checkbox
                        id={`event-division-${division.id}`}
                        checked={picked.has(division.id)}
                        onCheckedChange={(checked) =>
                          onChange(
                            checked
                              ? [...value, division.id]
                              : value.filter((id) => id !== division.id),
                          )
                        }
                      />
                      <FieldLabel htmlFor={`event-division-${division.id}`} className="font-normal">
                        {division.name}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
      {error && <FieldDescription>{error}</FieldDescription>}
    </FieldSet>
  );
}
