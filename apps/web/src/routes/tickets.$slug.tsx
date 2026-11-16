import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CircleCheck, Ticket as TicketIcon } from "lucide-react";

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
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
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
          <Skeleton className="h-[36rem] w-full rounded-3xl" />
        </div>
      ) : held.isError ? (
        held.error instanceof ApiError && held.error.status === 404 ? (
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed p-10 text-center">
            <TicketIcon className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">คุณยังไม่มีตั๋วกิจกรรมนี้</p>
            <Button
              render={<Link to="/events/$eventId" params={{ eventId: eventRef }} />}
              nativeButton={false}
            >
              ไปหน้ากิจกรรม
            </Button>
          </div>
        ) : (
          <ErrorState error={held.error} onRetry={held.refetch} title="โหลดตั๋วไม่สำเร็จ" />
        )
      ) : (
        <TicketStub ticket={held.data.ticket} />
      )}
    </div>
  );
}

/** A paper-ticket look: event on top, a torn line, then the QR. */
function TicketStub({ ticket }: { ticket: Ticket }) {
  const checkedInAt = ticket.checkedInAt;
  return (
    <article className="overflow-hidden rounded-3xl border bg-card shadow-sm">
      <div className="relative">
        <SportThumbnail
          src={ticket.event.thumbnailUrl}
          icon={ticket.event.sports[0]?.icon ?? "general"}
          seed={ticket.event.id}
          label={ticket.event.name}
          className="aspect-[5/2]"
        />
        <EventDateChip startAt={ticket.event.startAt} className="absolute top-3 left-3" />
      </div>
      <div className="flex flex-col gap-2 p-5">
        <h1 className="text-xl font-bold text-balance">{ticket.event.name}</h1>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <EventWhen startAt={ticket.event.startAt} endAt={ticket.event.endAt} />
          <EventWhere venue={ticket.venue} />
        </div>
      </div>

      {/* The tear line, with a notch cut out on each side. */}
      <div aria-hidden className="relative h-6">
        <div className="absolute inset-x-6 top-1/2 border-t-2 border-dashed" />
        <div className="absolute top-0 -left-3 size-6 rounded-full border bg-background" />
        <div className="absolute top-0 -right-3 size-6 rounded-full border bg-background" />
      </div>

      <div className="flex flex-col items-center gap-4 p-6 pt-3">
        <TicketQr code={ticket.code} label={`QR ตั๋ว ${ticket.event.name}`} className="max-w-72" />
        {checkedInAt ? (
          <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-5" aria-hidden />
            เช็คอินแล้ว {formatBangkok(Date.parse(checkedInAt), "time")}
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            แสดง QR นี้ที่จุดเช็คอินหน้างาน เพิ่มความสว่างหน้าจอให้สแกนง่ายขึ้น
          </p>
        )}
        <Button
          variant="outline"
          render={<Link to="/events/$eventId" params={{ eventId: ticketRef(ticket.event) }} />}
          nativeButton={false}
        >
          ดูรายละเอียดกิจกรรม
        </Button>
      </div>
    </article>
  );
}
