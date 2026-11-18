import { EVENT_TYPE_LABELS, type EventType } from "@it3k/db/event-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarRange, CircleCheck, Ticket as TicketIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Seats, useClaimTicket } from "@/components/event-claim";
import { EventDateChip, EventWhen, EventWhere } from "@/components/event-when-where";
import { LoadingButton } from "@/components/loading-button";
import { ParticipantShell } from "@/components/participant-shell";
import { SegmentedControl } from "@/components/segmented-control";
import { SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import { requireParticipantSession } from "@/lib/participant-auth";
import { type OpenEvent, TICKETS_KEY, ticketRef } from "@/lib/tickets";

export const Route = createFileRoute("/events")({
  ssr: false,
  beforeLoad: async ({ context, location }) => ({
    session: await requireParticipantSession(context.queryClient, location.href),
  }),
  head: () => ({
    meta: [{ title: "กิจกรรม · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: EventsPage,
});

function EventsPage() {
  const { session } = Route.useRouteContext();
  return (
    <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
      <EventsView />
    </ParticipantShell>
  );
}

type Show = "all" | EventType | "mine";

const matches = (item: OpenEvent, show: Show) =>
  show === "all" || (show === "mine" ? item.claimed : item.type === show);

/** Events open for tickets that the signed-in account may claim, soonest first. */
export function EventsView() {
  const { tickets } = useApis();
  const open = useQuery({
    queryKey: [...TICKETS_KEY, "events"],
    queryFn: () => tickets.openEvents(),
  });
  const [show, setShow] = useState<Show>("all");
  const items = open.data?.items ?? [];
  const visible = items.filter((item) => matches(item, show));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <CalendarRange className="size-7 text-primary" aria-hidden />
            กิจกรรม
          </h1>
          <p className="text-muted-foreground">รับตั๋วกิจกรรมที่เปิดอยู่ แล้วแสดง QR ของตั๋วที่จุดเช็คอินหน้างาน</p>
        </div>
        <Button
          variant="outline"
          className="self-start sm:self-auto"
          render={<Link to="/me/tickets" />}
          nativeButton={false}
        >
          <TicketIcon data-icon="inline-start" aria-hidden />
          ตั๋วของฉัน
        </Button>
      </header>

      {open.isPending ? (
        <div role="status" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : open.isError ? (
        <ErrorState error={open.error} onRetry={open.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarRange} description="ตอนนี้ยังไม่มีกิจกรรมที่เปิดรับตั๋ว" />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<Show>
              label="แสดง"
              value={show}
              onChange={setShow}
              className="max-w-full overflow-x-auto"
              segments={[
                { value: "all", label: "ทั้งหมด" },
                { value: "sport", label: EVENT_TYPE_LABELS.sport },
                { value: "general", label: EVENT_TYPE_LABELS.general },
                { value: "mine", label: "มีตั๋วแล้ว" },
              ]}
            />
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {visible.length.toLocaleString("th-TH")} กิจกรรม
            </p>
          </div>
          {visible.length === 0 ? (
            <EmptyState
              icon={show === "mine" ? TicketIcon : CalendarRange}
              description={show === "mine" ? "ยังไม่ได้รับตั๋วกิจกรรมไหน" : "ไม่มีกิจกรรมประเภทนี้ที่เปิดรับตั๋ว"}
            />
          ) : (
            // Every row as tall as the tallest card, so all cards are one size.
            <ul className="grid auto-rows-fr gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((item) => (
                <li key={item.id} className="flex">
                  <EventCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One event as a poster card. The whole card opens the event's page (the
 * title's link stretches over it); the claim button sits above that link.
 */
function EventCard({ item }: { item: OpenEvent }) {
  const claim = useClaimTicket(item);
  // Only the types the caller may take, or already holds.
  const types = item.ticketTypes.filter((type) => type.eligible || type.held > 0);
  const only = types.length === 1 ? types[0] : undefined;

  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md">
      <div className="relative overflow-hidden">
        <SportThumbnail
          src={item.thumbnailUrl}
          icon={item.sports[0]?.icon ?? "general"}
          seed={item.id}
          label={item.name}
          className="transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <EventDateChip startAt={item.startAt} className="absolute top-3 left-3" />
        <Badge variant="secondary" className="absolute top-3 right-3 shadow-md">
          {EVENT_TYPE_LABELS[item.type]}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <h2 className="line-clamp-2 min-h-[2lh] text-lg font-semibold text-balance">
          <Link
            to="/events/$eventId"
            params={{ eventId: item.slug ?? item.id }}
            className="outline-none after:absolute after:inset-0 after:content-['']"
          >
            {item.name}
          </Link>
        </h2>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <EventWhen startAt={item.startAt} endAt={item.endAt} />
          <EventWhere venue={item.venue} />
        </div>
        {item.sports.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {item.sports.map((sport) => (
              <Badge key={sport.id} variant="outline">
                {sport.name}
              </Badge>
            ))}
          </span>
        )}
        {item.description && (
          <p className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">
            {item.description}
          </p>
        )}

        <div className="relative z-10 mt-auto flex flex-col gap-3 pt-2">
          {item.claimed ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge className="bg-emerald-600 text-white">
                <CircleCheck data-icon="inline-start" aria-hidden />
                รับตั๋วแล้ว
              </Badge>
              <Button
                variant="outline"
                render={<Link to="/tickets/$slug" params={{ slug: ticketRef(item) }} />}
                nativeButton={false}
              >
                <TicketIcon data-icon="inline-start" aria-hidden />
                ดูตั๋ว
              </Button>
            </div>
          ) : only ? (
            <>
              <Seats capacity={only.capacity} remaining={only.remaining} />
              <LoadingButton
                icon={TicketIcon}
                className="h-11 w-full sm:h-9"
                loading={claim.isPending}
                disabled={!only.canClaim}
                onClick={() => claim.mutate({ id: only.id, name: only.name })}
              >
                {only.canClaim ? "รับตั๋ว" : only.refusal === "full" ? "ตั๋วเต็มแล้ว" : "ปิดรับแล้ว"}
              </LoadingButton>
            </>
          ) : types.length > 1 ? (
            <>
              <Seats capacity={item.capacity} remaining={item.remaining} />
              <Button
                className="h-11 w-full sm:h-9"
                render={<Link to="/events/$eventId" params={{ eventId: item.slug ?? item.id }} />}
                nativeButton={false}
              >
                <TicketIcon data-icon="inline-start" aria-hidden />
                เลือกประเภทตั๋ว ({types.length})
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">ยังไม่มีตั๋วที่เปิดให้คุณรับ</p>
          )}
        </div>
      </div>
    </article>
  );
}
