import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@it3k/ui/components/card";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarRange, CircleCheck, Ticket as TicketIcon } from "lucide-react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { EventWhen, EventWhere } from "@/components/event-when-where";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { ParticipantShell } from "@/components/participant-shell";
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

/** Events open for tickets that the signed-in account may claim, soonest first. */
export function EventsView() {
  const { tickets } = useApis();
  const open = useQuery({
    queryKey: [...TICKETS_KEY, "events"],
    queryFn: () => tickets.openEvents(),
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          icon={CalendarRange}
          title="กิจกรรม"
          description="กิจกรรมที่เปิดรับตั๋ว รับตั๋วแล้วแสดง QR ที่จุดเช็คอิน"
        />
        <Button variant="outline" render={<Link to="/me/tickets" />} nativeButton={false}>
          <TicketIcon data-icon="inline-start" aria-hidden />
          ตั๋วของฉัน
        </Button>
      </div>
      {open.isPending ? (
        <div role="status" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : open.isError ? (
        <ErrorState error={open.error} onRetry={open.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
      ) : open.data.items.length === 0 ? (
        <p className="text-muted-foreground">ตอนนี้ยังไม่มีกิจกรรมที่เปิดรับตั๋ว</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {open.data.items.map((item) => (
            <EventCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

const REFUSALS = {
  closed: "กิจกรรมนี้ปิดรับตั๋วแล้ว",
  full: "ตั๋วกิจกรรมนี้เต็มแล้ว",
  "not-listed": "คุณไม่อยู่ในรายชื่อของกิจกรรมนี้",
  missing: "ไม่พบกิจกรรมนี้",
} as const;

function EventCard({ item }: { item: OpenEvent }) {
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.name}</CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <EventWhen startAt={item.startAt} endAt={item.endAt} />
          <EventWhere venue={item.venue} />
        </CardDescription>
      </CardHeader>
      {item.description && (
        <CardContent>
          <p className="line-clamp-3 text-sm whitespace-pre-wrap">{item.description}</p>
        </CardContent>
      )}
      <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-3">
        {item.claimed ? (
          <>
            <Badge>
              <CircleCheck data-icon="inline-start" aria-hidden />
              รับตั๋วแล้ว
            </Badge>
            <Button variant="outline" render={<Link to="/me/tickets" />} nativeButton={false}>
              <TicketIcon data-icon="inline-start" aria-hidden />
              ดูตั๋ว
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              {item.remaining === null
                ? "ไม่จำกัดจำนวน"
                : soldOut
                  ? "เต็มแล้ว"
                  : `เหลือ ${item.remaining.toLocaleString("th-TH")} ที่`}
            </span>
            <LoadingButton
              icon={TicketIcon}
              loading={claim.isPending}
              disabled={soldOut}
              onClick={() => claim.mutate()}
            >
              รับตั๋ว
            </LoadingButton>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
