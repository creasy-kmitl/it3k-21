import { EVENT_TYPE_LABELS } from "@it3k/db/event-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Separator } from "@it3k/ui/components/separator";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarDays,
  CalendarX,
  CircleCheck,
  ExternalLink,
  Lock,
  type LucideIcon,
  MapPin,
  Tag,
  Ticket as TicketIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Seats, useClaimTicket } from "@/components/event-claim";
import { EventDateChip } from "@/components/event-when-where";
import { LoadingButton } from "@/components/loading-button";
import { ParticipantShell } from "@/components/participant-shell";
import { SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import { formatBangkok, formatRange } from "@/lib/bangkok-time";
import { ApiError } from "@/lib/leadership";
import { requireParticipantSession } from "@/lib/participant-auth";
import { type EventDetail, TICKETS_KEY, ticketRef } from "@/lib/tickets";

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

/** One event: details on the left, a sticky card with the ticket action on the right. */
export function EventView({ eventId }: { eventId: string }) {
  const { tickets } = useApis();
  const detail = useQuery({
    queryKey: [...TICKETS_KEY, "event", eventId],
    queryFn: () => tickets.event(eventId),
  });

  if (detail.isPending) {
    return (
      <div role="status" className="grid w-full gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <span className="sr-only">กำลังโหลด</span>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="aspect-video w-full rounded-3xl" />
        </div>
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="flex w-full flex-col gap-6">
        <BackToEvents />
        {detail.error instanceof ApiError && detail.error.status === 404 ? (
          <EmptyState
            icon={CalendarX}
            title="ไม่พบกิจกรรมนี้"
            description="กิจกรรมนี้อาจถูกลบ หรือไม่ได้เปิดให้คุณรับตั๋ว"
          />
        ) : (
          <ErrorState error={detail.error} onRetry={detail.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
        )}
      </div>
    );
  }

  const item = detail.data;
  return (
    // Phones stack header, card, then details; wide screens put the card in
    // its own column beside both, sticky while the details scroll.
    <article className="grid w-full gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-12">
      <header className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1">
        <BackToEvents />
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{item.name}</h1>
        <span className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{EVENT_TYPE_LABELS[item.type]}</Badge>
          {item.sports.map((sport) => (
            <Badge key={sport.id} variant="outline">
              {sport.name}
            </Badge>
          ))}
        </span>
      </header>

      <aside className="self-start lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <EventCard item={item} />
      </aside>

      <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-2">
        <Separator className="hidden lg:block" />
        {/* The card already shows the picture on phones. */}
        <SportThumbnail
          src={item.thumbnailUrl}
          icon={item.sports[0]?.icon ?? "general"}
          seed={item.id}
          label={item.name}
          className="hidden rounded-3xl border lg:block"
        />
        {item.description ? (
          <section aria-labelledby="about-event" className="flex flex-col gap-2">
            <h2 id="about-event" className="text-lg font-semibold">
              รายละเอียด
            </h2>
            <p className="leading-relaxed whitespace-pre-wrap">{item.description}</p>
          </section>
        ) : null}
      </div>
    </article>
  );
}

function BackToEvents() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 self-start"
      render={<Link to="/events" />}
      nativeButton={false}
    >
      <ArrowLeft data-icon="inline-start" aria-hidden />
      กิจกรรมทั้งหมด
    </Button>
  );
}

function EventCard({ item }: { item: EventDetail }) {
  const start = Date.parse(item.startAt);
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
      <div className="relative">
        <SportThumbnail
          src={item.thumbnailUrl}
          icon={item.sports[0]?.icon ?? "general"}
          seed={item.id}
          label={item.name}
        />
        <EventDateChip startAt={item.startAt} className="absolute top-3 left-3" />
      </div>
      <div aria-hidden className="h-1 bg-primary" />
      <dl className="flex flex-col gap-4 p-5">
        <Fact icon={CalendarDays} label="วันเวลาจัดงาน">
          {formatBangkok(start, "day")} · {formatRange(start, Date.parse(item.endAt))}
        </Fact>
        {item.venue ? (
          <Fact icon={MapPin} label="สถานที่">
            {item.venue.externalUrl ? (
              <a
                href={item.venue.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                {item.venue.name}
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                <span className="sr-only">(เปิดแผนที่)</span>
              </a>
            ) : (
              item.venue.name
            )}
          </Fact>
        ) : null}
        <Fact icon={Tag} label="ประเภท">
          {[EVENT_TYPE_LABELS[item.type], ...item.sports.map((sport) => sport.name)].join(" · ")}
        </Fact>
      </dl>
      <div className="flex flex-col gap-3 border-t p-5">
        <TicketAction item={item} />
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="text-sm text-muted-foreground">{children}</dd>
      </div>
    </div>
  );
}

/** The card's call to action. The QR itself lives only on the ticket's page. */
function TicketAction({ item }: { item: EventDetail }) {
  const claim = useClaimTicket(item);

  if (item.ticket) {
    const checkedInAt = item.ticket.checkedInAt;
    return (
      <>
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <CircleCheck className="size-4" aria-hidden />
          {checkedInAt
            ? `เช็คอินแล้ว ${formatBangkok(Date.parse(checkedInAt), "time")}`
            : "คุณมีตั๋วกิจกรรมนี้แล้ว"}
        </p>
        <Button
          size="lg"
          render={<Link to="/tickets/$slug" params={{ slug: ticketRef(item) }} />}
          nativeButton={false}
        >
          <TicketIcon data-icon="inline-start" aria-hidden />
          ดูตั๋ว
        </Button>
      </>
    );
  }

  if (!item.open) {
    return (
      <Button size="lg" variant="secondary" disabled>
        <Lock data-icon="inline-start" aria-hidden />
        ปิดรับตั๋วแล้ว
      </Button>
    );
  }

  const soldOut = item.remaining === 0;
  return (
    <>
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
