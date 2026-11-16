import { EVENT_TYPE_LABELS, type EventType } from "@it3k/db/event-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarRange, CircleCheck, Ticket as TicketIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { EventDateChip, EventWhen, EventWhere } from "@/components/event-when-where";
import { LoadingButton } from "@/components/loading-button";
import { ParticipantShell } from "@/components/participant-shell";
import { SegmentedControl } from "@/components/segmented-control";
import { SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { requireParticipantSession } from "@/lib/participant-auth";
import { type OpenEvent, TICKETS_KEY, claimRefusal } from "@/lib/tickets";

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
  // The soonest event leads the page, while nothing is filtered out.
  const [featured, ...rest] = show === "all" ? visible : [];
  const grid = show === "all" ? rest : visible;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarRange className="size-4" aria-hidden />
            IT3Kings
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">กิจกรรม</h1>
          <p className="max-w-prose text-muted-foreground">
            รับตั๋วกิจกรรมที่เปิดอยู่ แล้วแสดง QR ของตั๋วที่จุดเช็คอินหน้างาน
          </p>
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
          <Skeleton className="h-80 rounded-2xl sm:col-span-2 lg:col-span-3" />
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : open.isError ? (
        <ErrorState error={open.error} onRetry={open.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
      ) : items.length === 0 ? (
        <EmptyState text="ตอนนี้ยังไม่มีกิจกรรมที่เปิดรับตั๋ว" />
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
              text={show === "mine" ? "ยังไม่ได้รับตั๋วกิจกรรมไหน" : "ไม่มีกิจกรรมประเภทนี้ที่เปิดรับตั๋ว"}
            />
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featured && <EventCard item={featured} featured />}
              {grid.map((item) => (
                <EventCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed p-12 text-center text-muted-foreground">
      <CalendarRange className="size-10" aria-hidden />
      <p>{text}</p>
    </div>
  );
}

const REFUSALS = {
  closed: "กิจกรรมนี้ปิดรับตั๋วแล้ว",
  full: "ตั๋วกิจกรรมนี้เต็มแล้ว",
  "not-listed": "คุณไม่อยู่ในรายชื่อของกิจกรรมนี้",
  missing: "ไม่พบกิจกรรมนี้",
} as const;

/** One event as a poster card; `featured` lays it out wide across the top. */
function EventCard({ item, featured = false }: { item: OpenEvent; featured?: boolean }) {
  const { tickets } = useApis();
  const queryClient = useQueryClient();
  const claim = useMutation({
    mutationFn: () => tickets.claim(item.id),
    onSuccess: () => toast.success(`รับตั๋ว ${item.name} แล้ว`),
    onError: (error) => {
      const refusal = claimRefusal(error);
      if (refusal) toast.error(REFUSALS[refusal]);
      else toastError(error, "รับตั๋วไม่สำเร็จ");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
  });
  const soldOut = item.remaining === 0;
  const titleId = `event-${item.id}`;

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow hover:shadow-md",
        featured && "sm:col-span-2 lg:col-span-3 lg:flex-row",
      )}
    >
      <div className={cn("relative overflow-hidden", featured && "lg:w-3/5")}>
        <SportThumbnail
          src={item.thumbnailUrl}
          icon={item.sports[0]?.icon ?? "general"}
          seed={item.id}
          label={item.name}
          className={cn(
            "transition-transform duration-300 group-hover:scale-[1.03]",
            featured && "lg:aspect-auto lg:h-full lg:min-h-80",
          )}
        />
        <EventDateChip startAt={item.startAt} className="absolute top-3 left-3" />
        <span className="absolute top-3 right-3 flex flex-wrap justify-end gap-1">
          {featured && <Badge className="shadow-md">ใกล้ที่สุด</Badge>}
          <Badge variant="secondary" className="shadow-md">
            {EVENT_TYPE_LABELS[item.type]}
          </Badge>
        </span>
      </div>

      <div className={cn("flex flex-1 flex-col gap-3 p-5", featured && "lg:justify-center lg:p-8")}>
        <h2
          id={titleId}
          className={cn(
            "font-semibold text-balance",
            featured ? "text-2xl lg:text-3xl" : "text-lg",
          )}
        >
          {item.name}
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
          <p
            className={cn(
              "text-sm whitespace-pre-wrap text-muted-foreground",
              featured ? "line-clamp-4" : "line-clamp-2",
            )}
          >
            {item.description}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-2">
          {item.claimed ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge className="bg-emerald-600 text-white">
                <CircleCheck data-icon="inline-start" aria-hidden />
                รับตั๋วแล้ว
              </Badge>
              <Button variant="outline" render={<Link to="/me/tickets" />} nativeButton={false}>
                <TicketIcon data-icon="inline-start" aria-hidden />
                ดูตั๋ว
              </Button>
            </div>
          ) : (
            <>
              <Seats capacity={item.capacity} remaining={item.remaining} />
              <LoadingButton
                icon={TicketIcon}
                size={featured ? "lg" : "default"}
                className={cn(!featured && "w-full", featured && "self-start")}
                loading={claim.isPending}
                disabled={soldOut}
                onClick={() => claim.mutate()}
              >
                {soldOut ? "ตั๋วเต็มแล้ว" : "รับตั๋ว"}
              </LoadingButton>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** Seats left, with a bar that fills as tickets go. */
function Seats({ capacity, remaining }: { capacity: number | null; remaining: number | null }) {
  if (capacity === null || remaining === null) {
    return <p className="text-sm text-muted-foreground">ไม่จำกัดจำนวน</p>;
  }
  const taken = capacity - remaining;
  const low = remaining > 0 && remaining <= Math.max(5, capacity * 0.1);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex justify-between text-sm">
        <span className={cn(low ? "font-medium text-amber-600" : "text-muted-foreground")}>
          {remaining === 0
            ? "เต็มแล้ว"
            : low
              ? `เหลือเพียง ${remaining.toLocaleString("th-TH")} ที่`
              : `เหลือ ${remaining.toLocaleString("th-TH")} ที่`}
        </span>
        <span className="text-muted-foreground">
          {taken.toLocaleString("th-TH")}/{capacity.toLocaleString("th-TH")}
        </span>
      </p>
      <div
        role="progressbar"
        aria-label="ตั๋วที่รับไปแล้ว"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={taken}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full",
            remaining === 0 ? "bg-muted-foreground" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, (taken / capacity) * 100)}%` }}
        />
      </div>
    </div>
  );
}
