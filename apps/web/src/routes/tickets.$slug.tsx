import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CalendarRange, CircleCheck, Ticket as TicketIcon, TicketX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { EventDateChip, EventWhen, EventWhere } from "@/components/event-when-where";
import { ParticipantShell } from "@/components/participant-shell";
import { SportThumbnail } from "@/components/sport-art";
import { TicketQr } from "@/components/ticket-qr";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { ApiError } from "@/lib/leadership";
import { requireParticipantSession } from "@/lib/participant-auth";
import { type Ticket, TICKETS_KEY, ticketRef } from "@/lib/tickets";

export const Route = createFileRoute("/tickets/$slug")({
  ssr: false,
  beforeLoad: async ({ context, location }) => ({
    session: await requireParticipantSession(context.queryClient, location.href),
  }),
  head: () => ({
    meta: [{ title: "ตั๋ว · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: TicketPage,
});

function TicketPage() {
  const { session } = Route.useRouteContext();
  const { slug } = Route.useParams();
  return (
    <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
      <TicketView eventRef={slug} />
    </ParticipantShell>
  );
}

/** The caller's ticket to one event, with the QR the kiosk scans. */
export function TicketView({ eventRef }: { eventRef: string }) {
  const { tickets } = useApis();
  const held = useQuery({
    queryKey: [...TICKETS_KEY, "ticket", eventRef],
    queryFn: () => tickets.ticketFor(eventRef),
  });

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 md:max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        render={<Link to="/me/tickets" />}
        nativeButton={false}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden />
        ตั๋วของฉัน
      </Button>

      {held.isPending ? (
        <div role="status">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-[36rem] w-full rounded-3xl md:h-80" />
        </div>
      ) : held.isError ? (
        held.error instanceof ApiError && held.error.status === 404 ? (
          <EmptyState
            icon={TicketX}
            title="ไม่พบตั๋วนี้"
            description="คุณยังไม่ได้รับตั๋วกิจกรรมนี้ หรือกิจกรรมนี้ไม่มีอยู่แล้ว"
            action={
              <>
                <Button
                  render={<Link to="/events/$eventId" params={{ eventId: eventRef }} />}
                  nativeButton={false}
                >
                  <CalendarRange data-icon="inline-start" aria-hidden />
                  ไปหน้ากิจกรรม
                </Button>
                <Button variant="outline" render={<Link to="/me/tickets" />} nativeButton={false}>
                  <TicketIcon data-icon="inline-start" aria-hidden />
                  ตั๋วของฉัน
                </Button>
              </>
            }
          />
        ) : (
          <ErrorState error={held.error} onRetry={held.refetch} title="โหลดตั๋วไม่สำเร็จ" />
        )
      ) : (
        <TicketStub ticket={held.data.ticket} />
      )}
    </div>
  );
}

/**
 * A paper ticket. Wide screens lay it on its side: the event's picture, the
 * details, a torn line, then the QR stub. Phones stack the same parts, so
 * the QR stays large enough for the kiosk camera.
 */
function TicketStub({ ticket }: { ticket: Ticket }) {
  const checkedInAt = ticket.checkedInAt;
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl border bg-card shadow-sm md:flex-row">
      <div className="relative md:w-52 md:shrink-0">
        <SportThumbnail
          src={ticket.event.thumbnailUrl}
          icon={ticket.event.sports[0]?.icon ?? "general"}
          seed={ticket.event.id}
          label={ticket.event.name}
          className="aspect-[5/2] md:absolute md:inset-0 md:aspect-auto md:h-full"
        />
        <EventDateChip startAt={ticket.event.startAt} className="absolute top-3 left-3" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 md:justify-center md:p-6">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">ตั๋วเข้างาน</p>
        <h1 className="text-xl font-bold text-balance md:text-2xl">{ticket.event.name}</h1>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <EventWhen startAt={ticket.event.startAt} endAt={ticket.event.endAt} />
          <EventWhere venue={ticket.venue} />
        </div>
        {checkedInAt ? (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-4" aria-hidden />
            เช็คอินแล้ว {formatBangkok(Date.parse(checkedInAt), "time")}
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          render={<Link to="/events/$eventId" params={{ eventId: ticketRef(ticket.event) }} />}
          nativeButton={false}
        >
          ดูรายละเอียดกิจกรรม
        </Button>
      </div>

      {/* The tear line, with a notch cut out at each end: across on phones, upright on wide screens. */}
      <div aria-hidden className="relative h-6 shrink-0 md:h-auto md:w-6">
        <div className="absolute inset-x-6 top-1/2 border-t-2 border-dashed md:inset-x-auto md:top-6 md:bottom-6 md:left-1/2 md:border-t-0 md:border-l-2" />
        <div className="absolute top-0 -left-3 size-6 rounded-full border bg-background md:-top-3 md:left-0" />
        <div className="absolute top-0 -right-3 size-6 rounded-full border bg-background md:top-auto md:right-auto md:-bottom-3 md:left-0" />
      </div>

      <div className="flex flex-col items-center justify-center gap-3 p-6 pt-3 md:w-64 md:shrink-0 md:p-6">
        <TicketQr
          code={ticket.code}
          label={`QR ตั๋ว ${ticket.event.name}`}
          className="max-w-72 md:max-w-52"
        />
        <p className="text-center text-xs text-muted-foreground">
          {checkedInAt ? "ตั๋วนี้ใช้เช็คอินแล้ว" : "แสดง QR นี้ที่จุดเช็คอินหน้างาน เพิ่มความสว่างหน้าจอให้สแกนง่ายขึ้น"}
        </p>
      </div>
    </article>
  );
}
