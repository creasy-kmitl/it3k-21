import { EVENT_TYPE_LABELS, type EventDraftInput } from "@it3k/db/event-rules";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import type { SportIcon } from "@it3k/db/sport-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarCheck, Clock, MapPin, Pencil, Plus, Ticket, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { CreateEventDialog } from "@/components/events/create-event-dialog";
import { ConfirmDelete } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { ShortcutHint } from "@/components/shortcut-hint";
import { SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import { formatBangkok, formatRange, startOfDay } from "@/lib/bangkok-time";
import { toastError } from "@/lib/errors";
import type { EventItem } from "@/lib/events";
import { ApiError } from "@/lib/leadership";

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

type Editing = { kind: "create" } | { kind: "delete"; event: EventItem };

export const NEW_EVENT_HOTKEY = "N" as const;

/** Sport and general events. The API enforces who may edit. */
export function EventsPage() {
  const { events: api } = useApis();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showPast, setShowPast] = useState(false);
  // Fixed for the visit, so the query key does not change every render.
  const [today] = useState(() => startOfDay(Date.now()));
  const events = useQuery({
    queryKey: ["events", { showPast }],
    queryFn: () => api.list(showPast ? {} : { endsAfter: today }),
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const canManage = events.data?.canManage ?? false;

  const create = useMutation({
    mutationFn: (input: EventDraftInput) => api.create(input),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      setEditing(null);
      await navigate({
        to: "/staff/events/$eventId",
        params: { eventId: created.slug ?? created.id },
        search: { tab: "edit" },
      });
    },
    // A taken slug shows on its field; anything else as a toast.
    onError: (error) => {
      if (!(error instanceof ApiError && error.status === 409)) toastError(error, "สร้างไม่สำเร็จ");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      toast.success("ลบแล้ว");
      setEditing(null);
    },
    onError: (error) => toastError(error, "ลบไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  });
  useHotkey(
    NEW_EVENT_HOTKEY,
    () => {
      create.reset();
      setEditing({ kind: "create" });
    },
    { enabled: canManage && editing === null },
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <PageHeader icon={CalendarCheck} title="กิจกรรม" description="การแข่งขันกีฬาและกิจกรรมทั่วไป" />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button
            variant="outline"
            className={canManage ? "h-11 sm:h-9" : "col-span-2 h-11 sm:h-9"}
            onClick={() => setShowPast((value) => !value)}
          >
            {showPast ? "เฉพาะที่ยังไม่จบ" : "แสดงที่จบแล้ว"}
          </Button>
          {canManage && (
            <Button
              className="h-11 sm:h-9"
              onClick={() => {
                create.reset();
                setEditing({ kind: "create" });
              }}
            >
              <Plus data-icon="inline-start" aria-hidden /> เพิ่มกิจกรรม
              <ShortcutHint hotkey={NEW_EVENT_HOTKEY} />
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
        <ErrorState error={events.error} onRetry={events.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
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
                  <h2 className="flex-1 font-semibold">
                    <Link
                      to="/staff/events/$eventId"
                      params={{ eventId: event.slug ?? event.id }}
                      className="underline-offset-4 hover:underline"
                    >
                      {event.name}
                    </Link>
                  </h2>
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
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Ticket className="size-4 shrink-0" aria-hidden />
                  {ticketSummary(event)}
                </p>
                {event.description && (
                  <p className="line-clamp-3 text-sm whitespace-pre-line">{event.description}</p>
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
              <div className="flex items-center justify-end gap-1 border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-auto h-11 sm:h-8"
                  render={
                    <Link
                      to="/staff/events/$eventId"
                      params={{ eventId: event.slug ?? event.id }}
                    />
                  }
                  nativeButton={false}
                >
                  <Users data-icon="inline-start" aria-hidden /> ผู้เข้าร่วม
                </Button>
                {canManage && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 sm:size-8"
                      aria-label={`แก้ไข ${event.name}`}
                      render={
                        <Link
                          to="/staff/events/$eventId"
                          params={{ eventId: event.slug ?? event.id }}
                          search={{ tab: "edit" }}
                        />
                      }
                      nativeButton={false}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 sm:size-8"
                      aria-label={`ลบ ${event.name}`}
                      onClick={() => setEditing({ kind: "delete", event })}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing?.kind === "create" && (
        <CreateEventDialog
          pending={create.isPending}
          error={
            create.error instanceof ApiError && create.error.status === 409
              ? create.error.message
              : undefined
          }
          onClose={() => setEditing(null)}
          onSubmit={(input) => create.mutate(input)}
        />
      )}
      {editing?.kind === "delete" && (
        <ConfirmDelete
          name={editing.event.name}
          description="ลบกิจกรรมนี้พร้อมตั๋วและการเช็คอินทั้งหมด"
          pending={remove.isPending}
          onClose={() => setEditing(null)}
          onConfirm={() => remove.mutate(editing.event.id)}
        />
      )}
    </div>
  );
}

/** "ตั๋ว 12/50 · เปิดรับ", for staff. */
export function ticketSummary(
  event: Pick<EventItem, "ticketsOpen" | "ticketCapacity" | "ticketCount">,
) {
  const count = event.ticketCount.toLocaleString("th-TH");
  const of =
    event.ticketCapacity === null ? "" : `/${event.ticketCapacity.toLocaleString("th-TH")}`;
  return `ตั๋ว ${count}${of} ใบ · ${event.ticketsOpen ? "เปิดรับ" : "ปิดรับ"}`;
}
