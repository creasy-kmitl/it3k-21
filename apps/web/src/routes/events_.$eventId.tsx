import { EVENT_TYPE_LABELS } from "@it3k/db/event-rules";
import { docFromText, hasContent } from "@it3k/db/rich-text";
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
import { RichTextView } from "@/components/rich-text-view";
import { SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import { formatBangkok, formatRange } from "@/lib/bangkok-time";
import { ApiError } from "@/lib/leadership";
import { requireParticipantSession } from "@/lib/participant-auth";
import {
  CLAIM_REFUSALS,
  type EventDetail,
  type OpenTicketType,
  TICKETS_KEY,
  ticketRef,
} from "@/lib/tickets";

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
  // Events saved before rich content keep their plain description.
  const content = item.content ?? (item.description ? docFromText(item.description) : null);
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
        {content && hasContent(content) ? (
          <section aria-labelledby="about-event" className="flex flex-col gap-2">
            <h2 id="about-event" className="text-lg font-semibold">
              รายละเอียด
            </h2>
            <RichTextView doc={content} size="lg" />
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

/** The types a caller sees: those they may claim or already hold. */
export const shownTypes = (item: EventDetail) =>
  item.ticketTypes.filter((type) => type.eligible || type.held > 0);

/**
 * The card's call to action: the tickets the caller holds, then one row per
 * ticket type with its seats and its own claim button. The QR itself lives
 * only on the ticket page.
 */
function TicketAction({ item }: { item: EventDetail }) {
  const claim = useClaimTicket(item);
  const types = shownTypes(item);
  const claimable = item.open ? types.filter((type) => type.canClaim) : [];
  const held = item.tickets;
  const checkedIn = held.filter((ticket) => ticket.checkedInAt).length;

  return (
    <>
      {held.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-4 shrink-0" aria-hidden />
            {held.length === 1
              ? held[0]?.checkedInAt
                ? `เช็คอินแล้ว ${formatBangkok(Date.parse(held[0].checkedInAt), "time")}`
                : "คุณมีตั๋วกิจกรรมนี้แล้ว"
              : `คุณมีตั๋ว ${held.length} ใบ${checkedIn > 0 ? ` · เช็คอินแล้ว ${checkedIn} ใบ` : ""}`}
          </p>
          <Button
            size="lg"
            className="h-11"
            render={<Link to="/tickets/$slug" params={{ slug: ticketRef(item) }} />}
            nativeButton={false}
          >
            <TicketIcon data-icon="inline-start" aria-hidden />
            {held.length > 1 ? "ดูตั๋วทั้งหมด" : "ดูตั๋ว"}
          </Button>
        </div>
      )}

      {!item.open ? (
        held.length === 0 && (
          <Button size="lg" variant="secondary" className="h-11" disabled>
            <Lock data-icon="inline-start" aria-hidden />
            ปิดรับตั๋วแล้ว
          </Button>
        )
      ) : types.length === 0 ? (
        held.length === 0 && (
          <p className="text-sm text-muted-foreground">ยังไม่มีตั๋วที่เปิดให้คุณรับ</p>
        )
      ) : (
        <>
          {item.capacity !== null && types.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">ที่นั่งรวมทั้งกิจกรรม</p>
              <Seats capacity={item.capacity} remaining={item.remaining} />
            </div>
          )}
          <ul aria-label="ประเภทตั๋ว" className="flex flex-col gap-3">
            {types.map((type) => (
              <li key={type.id}>
                <TicketTypeRow
                  type={type}
                  single={types.length === 1}
                  pending={claim.isPending && claim.variables?.id === type.id}
                  disabled={claim.isPending}
                  onClaim={() => claim.mutate({ id: type.id, name: type.name })}
                />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">ยกเลิกตั๋วเองได้ก่อนเช็คอิน ที่นั่งจะคืนให้คนอื่น</p>
        </>
      )}

      {/* On phones the card scrolls away, so the one ticket to take stays in reach. */}
      {claimable.length === 1 && held.length === 0 && claimable[0] && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <LoadingButton
            icon={TicketIcon}
            size="lg"
            className="h-11 w-full"
            loading={claim.isPending}
            onClick={() => {
              const type = claimable[0];
              if (type) claim.mutate({ id: type.id, name: type.name });
            }}
          >
            {types.length > 1 ? `รับตั๋ว ${claimable[0].name}` : "รับตั๋ว"}
          </LoadingButton>
        </div>
      )}
    </>
  );
}

/** What a type's button says when it cannot be pressed. */
function refusedLabel(type: OpenTicketType) {
  switch (type.refusal) {
    case "full":
      return "ตั๋วเต็มแล้ว";
    case "limit":
      return type.maxPerUser > 1 ? "รับครบแล้ว" : "รับแล้ว";
    case "closed":
    case "type-closed":
      return "ปิดรับแล้ว";
    default:
      return "รับไม่ได้";
  }
}

function TicketTypeRow({
  type,
  single,
  pending,
  disabled,
  onClaim,
}: {
  type: OpenTicketType;
  /** The only type: its name and box add nothing, so only seats and the button show. */
  single: boolean;
  pending: boolean;
  disabled: boolean;
  onClaim: () => void;
}) {
  const reason =
    type.refusal && type.refusal !== "limit" && type.refusal !== "full"
      ? CLAIM_REFUSALS[type.refusal]
      : null;
  const body = (
    <>
      {!single && (
        <div className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            {type.name}
            {type.held > 0 && (
              <Badge variant="secondary">
                มีแล้ว {type.maxPerUser > 1 ? `${type.held}/${type.maxPerUser}` : ""}
              </Badge>
            )}
          </p>
          {type.description && (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{type.description}</p>
          )}
        </div>
      )}
      {single && type.description && (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{type.description}</p>
      )}
      <Seats capacity={type.capacity} remaining={type.remaining} />
      {type.maxPerUser > 1 && (
        <p className="text-xs text-muted-foreground">รับได้สูงสุด {type.maxPerUser} ใบต่อคน</p>
      )}
      <LoadingButton
        icon={TicketIcon}
        size="lg"
        variant={type.canClaim ? "default" : "secondary"}
        className="h-11 w-full"
        loading={pending}
        disabled={!type.canClaim || disabled}
        aria-label={single ? undefined : `รับตั๋ว ${type.name}`}
        onClick={onClaim}
      >
        {type.canClaim ? (type.held > 0 ? "รับเพิ่ม" : "รับตั๋ว") : refusedLabel(type)}
      </LoadingButton>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    </>
  );
  return single ? (
    <div className="flex flex-col gap-3">{body}</div>
  ) : (
    <div className="flex flex-col gap-3 rounded-2xl border p-4">{body}</div>
  );
}
