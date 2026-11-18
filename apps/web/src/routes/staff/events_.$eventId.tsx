import { EVENT_TYPE_LABELS } from "@it3k/db/event-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@it3k/ui/components/tabs";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarCheck, ExternalLink, MapPin, Pencil, Ticket, Users } from "lucide-react";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { EventEditor } from "@/components/events/event-editor";
import { EventParticipants } from "@/components/events/event-participants";
import { PageHeader } from "@/components/page-header";
import { ShortcutHint } from "@/components/shortcut-hint";
import { useApis } from "@/lib/api-context";
import type { Decoder } from "@/lib/kiosk";
import { eventTime, ticketSummary } from "./events";

export const EVENT_TABS = ["participants", "edit"] as const;
export type EventTab = (typeof EVENT_TABS)[number];

const searchSchema = z.object({
  tab: z.enum(EVENT_TABS).optional().catch(undefined),
});

export const Route = createFileRoute("/staff/events_/$eventId")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({ meta: [{ title: "กิจกรรม · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const { tab = "participants" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <EventPage
      eventId={eventId}
      tab={tab}
      onTabChange={(next) =>
        navigate({ search: { tab: next === "participants" ? undefined : next }, replace: true })
      }
      onDeleted={() => navigate({ to: "/staff/events" })}
    />
  );
}

const TAB_HOTKEYS = { participants: "Mod+1", edit: "Mod+2" } as const satisfies Record<EventTab, string>;

/** One event for staff: its participants and check-in, and for managers its edit tab. */
export function EventPage({
  eventId,
  tab,
  onTabChange,
  onDeleted,
  decoderFactory,
}: {
  eventId: string;
  tab: EventTab;
  onTabChange: (tab: EventTab) => void;
  onDeleted: () => void;
  decoderFactory?: () => Promise<Decoder>;
}) {
  const { events: api } = useApis();
  const event = useQuery({ queryKey: ["events", eventId], queryFn: () => api.get(eventId) });
  const canManage = !!event.data?.canManage;
  // Someone who cannot edit lands on the participants even from an edit link.
  const shown: EventTab = tab === "edit" && !canManage ? "participants" : tab;

  useHotkey(TAB_HOTKEYS.participants, () => onTabChange("participants"), {
    ignoreInputs: false,
  });
  useHotkey(TAB_HOTKEYS.edit, () => onTabChange("edit"), {
    ignoreInputs: false,
    enabled: canManage,
  });

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        render={<Link to="/staff/events" />}
        nativeButton={false}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden /> กิจกรรมทั้งหมด
      </Button>

      {event.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : event.isError ? (
        <ErrorState error={event.error} onRetry={event.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <PageHeader
              icon={CalendarCheck}
              title={event.data.name}
              description={
                <span className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                  <span>{eventTime(event.data)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Ticket className="size-4 shrink-0" aria-hidden />
                    {ticketSummary(event.data)}
                  </span>
                  {event.data.venue && (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <MapPin className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{event.data.venue.name}</span>
                    </span>
                  )}
                </span>
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={event.data.type === "sport" ? "default" : "secondary"}>
                {EVENT_TYPE_LABELS[event.data.type]}
              </Badge>
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0"
                render={<Link to="/events/$eventId" params={{ eventId: event.data.slug ?? event.data.id }} />}
                nativeButton={false}
              >
                ดูหน้ากิจกรรม
                <ExternalLink data-icon="inline-end" aria-hidden />
              </Button>
            </div>
          </div>

          <Tabs value={shown} onValueChange={(value) => onTabChange(value as EventTab)}>
            {canManage && (
              <div className="sticky top-0 z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                <TabsList className="grid h-11 w-full grid-cols-2 sm:inline-flex sm:h-9 sm:w-fit">
                  <TabsTrigger value="participants">
                    <Users aria-hidden /> ผู้เข้าร่วม
                    <ShortcutHint hotkey={TAB_HOTKEYS.participants} />
                  </TabsTrigger>
                  <TabsTrigger value="edit">
                    <Pencil aria-hidden /> แก้ไข
                    <ShortcutHint hotkey={TAB_HOTKEYS.edit} />
                  </TabsTrigger>
                </TabsList>
              </div>
            )}
            <TabsContent value="participants" className="pt-2">
              <EventParticipants
                event={event.data}
                eventKey={eventId}
                decoderFactory={decoderFactory}
              />
            </TabsContent>
            {canManage && (
              <TabsContent value="edit" className="pt-2">
                {/* A new version (after a save) starts the form from what was saved. */}
                <EventEditor
                  key={`${event.data.id}:${event.data.version}`}
                  event={event.data}
                  onDeleted={onDeleted}
                />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}
