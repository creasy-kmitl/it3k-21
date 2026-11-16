import { EVENT_TYPE_LABELS } from "@it3k/db/event-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CircleCheck, ExternalLink, Lock, Ticket as TicketIcon } from "lucide-react";

import { ErrorState } from "@/components/error-state";
import { Seats, useClaimTicket } from "@/components/event-claim";
import { EventDateChip, EventWhen, EventWhere } from "@/components/event-when-where";
import { LoadingButton } from "@/components/loading-button";
import { ParticipantShell } from "@/components/participant-shell";
import { SportThumbnail } from "@/components/sport-art";
import { TicketQr } from "@/components/ticket-qr";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { ApiError } from "@/lib/leadership";
import { requireParticipantSession } from "@/lib/participant-auth";
import { type EventDetail, TICKETS_KEY } from "@/lib/tickets";

export const Route = createFileRoute("/events_/$eventId")({
  ssr: false,
  beforeLoad: async ({ context, location }) => ({
    session: await requireParticipantSession(context.queryClient, location.href),
  }),
  head: () => ({
    meta: [{ title: "กิจกรรม · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: EventPage,
});

function EventPage() {
  const { session } = Route.useRouteContext();
  const { eventId } = Route.useParams();
  return (
    <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
      <EventView eventId={eventId} />
    </ParticipantShell>
  );
}

/** One event: its picture, details, and the ticket (or the way to claim one). */
export function EventView({ eventId }: { eventId: string }) {
  const { tickets } = useApis();
  const detail = useQuery({
    queryKey: [...TICKETS_KEY, "event", eventId],
    queryFn: () => tickets.event(eventId),
  });

  return (
    <div className="flex w-full flex-col gap-6">
      <Button
        variant="ghost"
        className="self-start"
        render={<Link to="/events" />}
        nativeButton={false}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden />
        กิจกรรมทั้งหมด
      </Button>

      {detail.isPending ? (
        <div role="status" className="flex flex-col gap-6">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="aspect-[21/9] w-full rounded-3xl" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : detail.isError ? (
        detail.error instanceof ApiError && detail.error.status === 404 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed p-12 text-center text-muted-foreground">
            <p>ไม่พบกิจกรรมนี้ หรือกิจกรรมนี้ไม่ได้เปิดให้คุณรับตั๋ว</p>
          </div>
        ) : (
          <ErrorState error={detail.error} onRetry={detail.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
        )
      ) : (
        <EventBody item={detail.data} />
      )}
    </div>
  );
}

function EventBody({ item }: { item: EventDetail }) {
  return (
    <article className="flex flex-col gap-8">
      <div className="relative overflow-hidden rounded-3xl border">
        <SportThumbnail
          src={item.thumbnailUrl}
          icon={item.sports[0]?.icon ?? "general"}
          seed={item.id}
          label={item.name}
          className="aspect-video sm:aspect-[21/9]"
        />
        <EventDateChip startAt={item.startAt} className="absolute top-4 left-4 scale-110" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <span className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{EVENT_TYPE_LABELS[item.type]}</Badge>
              {item.sports.map((sport) => (
                <Badge key={sport.id} variant="outline">
                  {sport.name}
                </Badge>
              ))}
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-balance">{item.name}</h1>
          </div>
          <div className="flex flex-col gap-2 text-muted-foreground">
            <EventWhen startAt={item.startAt} endAt={item.endAt} />
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <EventWhere venue={item.venue} />
              {item.venue?.externalUrl && (
                <a
                  href={item.venue.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                >
                  ดูแผนที่
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </span>
          </div>
          {item.description && (
            <section aria-labelledby="about-event" className="flex flex-col gap-2">
              <h2 id="about-event" className="text-lg font-semibold">
                รายละเอียด
              </h2>
              <p className="leading-relaxed whitespace-pre-wrap">{item.description}</p>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-xs lg:sticky lg:top-20">
          <TicketPanel item={item} />
        </aside>
      </div>
    </article>
  );
}

function TicketPanel({ item }: { item: EventDetail }) {
  const claim = useClaimTicket(item);

  if (item.ticket) {
    const checkedInAt = item.ticket.checkedInAt;
    return (
      <>
        <h2 className="flex items-center gap-2 font-semibold">
          <TicketIcon className="size-5 text-primary" aria-hidden />
          ตั๋วของคุณ
        </h2>
        {checkedInAt ? (
          <Badge className="self-start">
            <CircleCheck data-icon="inline-start" aria-hidden />
            เช็คอินแล้ว {formatBangkok(Date.parse(checkedInAt), "time")}
          </Badge>
        ) : (
          <p className="text-sm text-muted-foreground">แสดง QR นี้ที่จุดเช็คอินหน้างาน</p>
        )}
        <div className="flex justify-center">
          <TicketQr code={item.ticket.code} label={`QR ตั๋ว ${item.name}`} />
        </div>
        <Button variant="outline" render={<Link to="/me/tickets" />} nativeButton={false}>
          ตั๋วทั้งหมดของฉัน
        </Button>
      </>
    );
  }

  if (!item.open) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Lock className="size-4" aria-hidden />
        ปิดรับตั๋วแล้ว
      </p>
    );
  }

  const soldOut = item.remaining === 0;
  return (
    <>
      <h2 className="flex items-center gap-2 font-semibold">
        <TicketIcon className="size-5 text-primary" aria-hidden />
        รับตั๋ว
      </h2>
      <Seats capacity={item.capacity} remaining={item.remaining} />
      <LoadingButton
        icon={TicketIcon}
        size="lg"
        loading={claim.isPending}
        disabled={soldOut}
        onClick={() => claim.mutate()}
      >
        {soldOut ? "ตั๋วเต็มแล้ว" : "รับตั๋ว"}
      </LoadingButton>
      <p className="text-xs text-muted-foreground">ยกเลิกตั๋วเองได้ก่อนเช็คอิน ที่นั่งจะคืนให้คนอื่น</p>
    </>
  );
}
