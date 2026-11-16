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
import { ArrowLeft, CalendarRange, CircleCheck, Ticket as TicketIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { EventDateChip, EventWhen, EventWhere } from "@/components/event-when-where";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { ParticipantShell } from "@/components/participant-shell";
import { SportThumbnail } from "@/components/sport-art";
import { TicketQr } from "@/components/ticket-qr";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { toastError } from "@/lib/errors";
import { requireParticipantSession } from "@/lib/participant-auth";
import { TICKETS_KEY, type Ticket } from "@/lib/tickets";

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

function TicketsPage() {
  const { session } = Route.useRouteContext();
  return (
    <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
      <TicketsView />
    </ParticipantShell>
  );
}

/** The signed-in account's tickets; claiming happens on /events. */
export function TicketsView() {
  const { tickets } = useApis();
  const mine = useQuery({ queryKey: [...TICKETS_KEY, "mine"], queryFn: () => tickets.mine() });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          icon={TicketIcon}
          title="ตั๋วของฉัน"
          description="แสดง QR ของตั๋วที่จุดเช็คอินของกิจกรรม"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<Link to="/me" />} nativeButton={false}>
            <ArrowLeft data-icon="inline-start" aria-hidden />
            โปรไฟล์ของฉัน
          </Button>
          <Button render={<Link to="/events" />} nativeButton={false}>
            <CalendarRange data-icon="inline-start" aria-hidden />
            ดูกิจกรรม
          </Button>
        </div>
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
          <p className="text-muted-foreground">
            ยังไม่มีตั๋ว{" "}
            <Link to="/events" className="text-primary underline-offset-4 hover:underline">
              รับตั๋วได้ที่หน้ากิจกรรม
            </Link>
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.data.items.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const [confirming, setConfirming] = useState(false);
  const checkedIn = ticket.checkedInAt !== null;
  return (
    <Card className="pt-0">
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
      <CardHeader>
        <CardTitle>{ticket.event.name}</CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <EventWhen startAt={ticket.event.startAt} endAt={ticket.event.endAt} />
          <EventWhere venue={ticket.venue} />
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
