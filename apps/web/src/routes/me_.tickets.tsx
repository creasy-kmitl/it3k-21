import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
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
import { ArrowLeft, CalendarDays, CircleCheck, MapPin, Ticket as TicketIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { ParticipantShell } from "@/components/participant-shell";
import { TicketQr } from "@/components/ticket-qr";
import { useApis } from "@/lib/api-context";
import { formatBangkok, formatRange } from "@/lib/bangkok-time";
import { toastError } from "@/lib/errors";
import { requireParticipantSession } from "@/lib/participant-auth";
import { type OpenEvent, type Ticket, claimRefusal } from "@/lib/tickets";

export const Route = createFileRoute("/me_/tickets")({
  ssr: false,
  beforeLoad: async ({ context, location }) => ({
    session: await requireParticipantSession(context.queryClient, location.href),
  }),
  head: () => ({
    meta: [{ title: "ตั๋วของฉัน · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: TicketsPage,
});

const TICKETS_KEY = ["tickets"] as const;

function TicketsPage() {
  const { session } = Route.useRouteContext();
  return (
    <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
      <TicketsView />
    </ParticipantShell>
  );
}

/** The signed-in account's tickets, then the events it can still claim. */
export function TicketsView() {
  const { tickets } = useApis();
  const mine = useQuery({ queryKey: [...TICKETS_KEY, "mine"], queryFn: () => tickets.mine() });
  const open = useQuery({
    queryKey: [...TICKETS_KEY, "events"],
    queryFn: () => tickets.openEvents(),
  });
  const claimable = (open.data?.items ?? []).filter((item) => !item.claimed);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          icon={TicketIcon}
          title="ตั๋วของฉัน"
          description="แสดง QR ของตั๋วที่จุดเช็คอินของกิจกรรม"
        />
        <Button variant="outline" render={<Link to="/me" />} nativeButton={false}>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          โปรไฟล์ของฉัน
        </Button>
      </div>

      <section aria-labelledby="my-tickets" className="flex flex-col gap-4">
        <h2 id="my-tickets" className="text-lg font-semibold">
          ตั๋วที่รับแล้ว
        </h2>
        {mine.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : mine.isError ? (
          <ErrorState error={mine.error} onRetry={mine.refetch} title="โหลดตั๋วไม่สำเร็จ" />
        ) : mine.data.items.length === 0 ? (
          <p className="text-muted-foreground">ยังไม่มีตั๋ว รับตั๋วจากกิจกรรมด้านล่างได้เลย</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.data.items.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="open-events" className="flex flex-col gap-4">
        <h2 id="open-events" className="text-lg font-semibold">
          กิจกรรมที่รับตั๋วได้
        </h2>
        {open.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : open.isError ? (
          <ErrorState error={open.error} onRetry={open.refetch} title="โหลดกิจกรรมไม่สำเร็จ" />
        ) : claimable.length === 0 ? (
          <p className="text-muted-foreground">ตอนนี้ไม่มีกิจกรรมที่เปิดรับตั๋วเพิ่ม</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {claimable.map((item) => (
              <OpenEventCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function When({ startAt, endAt }: { startAt: string; endAt: string }) {
  const start = Date.parse(startAt);
  return (
    <span className="flex items-center gap-2">
      <CalendarDays className="size-4 shrink-0" aria-hidden />
      {formatBangkok(start, "day")} · {formatRange(start, Date.parse(endAt))}
    </span>
  );
}

function Where({ venue }: { venue: { name: string } | null }) {
  if (!venue) return null;
  return (
    <span className="flex items-center gap-2">
      <MapPin className="size-4 shrink-0" aria-hidden />
      {venue.name}
    </span>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const [confirming, setConfirming] = useState(false);
  const checkedIn = ticket.checkedInAt !== null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{ticket.event.name}</CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <When startAt={ticket.event.startAt} endAt={ticket.event.endAt} />
          <Where venue={ticket.venue} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {checkedIn ? (
          <Badge className="self-start">
            <CircleCheck data-icon="inline-start" aria-hidden />
            เช็คอินแล้ว {formatBangkok(Date.parse(ticket.checkedInAt ?? ""), "time")}
          </Badge>
        ) : null}
        <TicketQr code={ticket.code} label={`QR ตั๋ว ${ticket.event.name}`} />
      </CardContent>
      {!checkedIn && (
        <CardFooter>
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            ยกเลิกตั๋ว
          </Button>
        </CardFooter>
      )}
      {confirming && <CancelDialog ticket={ticket} onClose={() => setConfirming(false)} />}
    </Card>
  );
}

function CancelDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { tickets } = useApis();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => tickets.cancel(ticket.id),
    onSuccess: () => {
      toast.success("ยกเลิกตั๋วแล้ว");
      onClose();
    },
    onError: (error) => toastError(error, "ยกเลิกตั๋วไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ยกเลิกตั๋ว {ticket.event.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            ที่นั่งจะคืนให้คนอื่น รับใหม่ได้ถ้ากิจกรรมยังเปิดรับและยังไม่เต็ม
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ไม่ยกเลิก</AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            ยกเลิกตั๋ว
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const REFUSALS = {
  closed: "กิจกรรมนี้ปิดรับตั๋วแล้ว",
  full: "ตั๋วกิจกรรมนี้เต็มแล้ว",
  "not-listed": "คุณไม่อยู่ในรายชื่อของกิจกรรมนี้",
  missing: "ไม่พบกิจกรรมนี้",
} as const;

function OpenEventCard({ item }: { item: OpenEvent }) {
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
          <When startAt={item.startAt} endAt={item.endAt} />
          <Where venue={item.venue} />
        </CardDescription>
      </CardHeader>
      {item.description && (
        <CardContent>
          <p className="line-clamp-3 text-sm whitespace-pre-wrap">{item.description}</p>
        </CardContent>
      )}
      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
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
      </CardFooter>
    </Card>
  );
}
