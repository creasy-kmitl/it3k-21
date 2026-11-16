import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { Clock, LogOut, ScanBarcode, UserPlus } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  CheckinCamera,
  ScanForm,
  describeResult,
  focusOnDesk,
  personName,
  resultKey,
  useScanCheckIn,
} from "@/components/checkin/scan-checkin";
import { ErrorState } from "@/components/error-state";
import { LoadingButton } from "@/components/loading-button";
import { SessionBoundary } from "@/components/session-boundary";
import { useApis } from "@/lib/api-context";
import { getSessionOrThrow } from "@/lib/auth-client";
import type { CheckinOutcome } from "@/lib/events";
import { type Decoder, createDecoder } from "@/lib/kiosk";
import { clearCacheOnUserChange } from "@/lib/query-cache";
import { staffRedirect } from "./staff/route";
import { eventTime } from "./staff/events";

export const Route = createFileRoute("/kiosk/$eventId")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await getSessionOrThrow();
    clearCacheOnUserChange(context.queryClient, session.data?.user.id ?? null);
    const away = staffRedirect(session.data?.user, location.href);
    if (away) throw redirect(away);
    return { session };
  },
  head: () => ({
    meta: [{ title: "Check-in Kiosk · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const { eventId } = Route.useParams();
  return (
    <SessionBoundary key={session.data?.user.id} userId={session.data?.user.id ?? ""}>
      <KioskPage eventId={eventId} />
    </SessionBoundary>
  );
}

/**
 * Full-screen check-in for one event: the camera reads the barcode on /me, a
 * USB scanner or the keyboard types into the box, and each result fills the
 * screen for a moment. The staff event page has a smaller scan drawer that
 * shares the same parts.
 */
export function KioskPage({
  eventId,
  decoderFactory = createDecoder,
}: {
  eventId: string;
  decoderFactory?: () => Promise<Decoder>;
}) {
  const { events: api } = useApis();
  const event = useQuery({ queryKey: ["events", eventId], queryFn: () => api.get(eventId) });
  // `eventId` may be a slug; once the event is loaded, its id keeps the kiosk
  // working even if someone renames the slug mid-event.
  const id = event.data?.id ?? eventId;
  const participants = useQuery({
    queryKey: ["events", eventId, "participants"],
    queryFn: () => api.participants(id),
  });
  const scan = useScanCheckIn({ eventKey: eventId, id });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => focusOnDesk(input), []);

  const items = participants.data?.items ?? [];
  const checkedIn = items.filter((item) => item.checkin).length;
  const canCheckIn = participants.data?.canCheckIn;

  if (participants.isSuccess && !canCheckIn) {
    return (
      <main className="flex min-h-dvh w-full min-w-0 flex-col items-center justify-center gap-4 bg-background p-4 text-center">
        <p role="alert" className="text-lg">
          บัญชีนี้ไม่มีสิทธิ์ใช้ Kiosk เช็คอิน
        </p>
        <Button render={<Link to="/staff/events" />} nativeButton={false} variant="outline">
          กลับ
        </Button>
      </main>
    );
  }

  // Everything below keeps its size while data loads, so the camera and the
  // input never jump: placeholders hold the title, time and count lines.
  // The root layout is a flex row, so without w-full the page shrinks to its
  // content and widens when the camera's video gets its real size.
  return (
    <main className="flex min-h-dvh w-full min-w-0 flex-col gap-4 bg-background p-4 md:p-6 wide:h-dvh wide:gap-6 wide:overflow-hidden wide:p-8 wide-xl:p-10">
      <header className="flex items-start gap-3 wide:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <ScanBarcode className="size-6 shrink-0 text-primary wide-xl:size-9" aria-hidden />
            {event.isPending ? (
              <Skeleton className="h-7 w-48 max-w-full md:h-8 md:w-72 wide-xl:h-10" />
            ) : (
              <h1 className="truncate text-xl font-semibold md:text-2xl wide-xl:text-4xl">
                {event.data?.name ?? "Kiosk เช็คอิน"}
              </h1>
            )}
          </div>
          <div className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground wide-xl:min-h-7 wide-xl:text-lg">
            {event.data ? (
              <>
                <Clock className="size-4 shrink-0 wide-xl:size-5" aria-hidden />
                <p className="min-w-0 truncate">
                  {eventTime(event.data)}
                  {event.data.venue && ` · ${event.data.venue.name}`}
                </p>
              </>
            ) : (
              event.isPending && <Skeleton className="h-4 w-56 max-w-full" />
            )}
          </div>
        </div>
        <p
          className="min-w-28 rounded-2xl border px-4 py-2 text-center wide:min-w-36 wide-xl:px-6 wide-xl:py-3"
          aria-live="polite"
        >
          <span className="block text-2xl font-semibold tabular-nums wide-xl:text-4xl">
            {participants.data ? checkedIn : "–"}
            <span className="text-base font-normal text-muted-foreground wide-xl:text-2xl">
              {" "}
              / {participants.data ? items.length : "–"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground wide-xl:text-sm">เช็คอินแล้ว</span>
        </p>
        <Button
          variant="outline"
          render={
            <Link to="/staff/events/$eventId" params={{ eventId: event.data?.slug ?? eventId }} />
          }
          nativeButton={false}
          className="wide:h-10 wide:px-4"
        >
          <LogOut data-icon="inline-start" aria-hidden /> ออก
        </Button>
      </header>

      {/* Phones and portrait screens stack; big landscape screens put the camera beside the input. */}
      <div className="flex flex-col gap-4 wide:grid wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] wide:gap-6 wide-xl:grid-cols-[minmax(0,1fr)_32rem]">
        <CheckinCamera
          decoderFactory={decoderFactory}
          onCode={scan.handleCode}
          className="mx-auto max-w-xl md:max-w-3xl wide:mx-0 wide:aspect-auto wide:h-full wide:max-w-none"
        />

        <aside className="mx-auto flex w-full max-w-xl flex-col gap-4 md:max-w-3xl wide:mx-0 wide:max-w-none wide:gap-6">
          <ScanForm
            onCode={scan.handleCode}
            pending={scan.pending}
            input={input}
            keepFocused
            inputClassName="wide:h-12 wide:px-4 wide:text-base wide-xl:h-14 wide-xl:text-lg"
            buttonClassName="wide:h-12 wide:px-5 wide:text-base wide-xl:h-14 wide-xl:text-lg"
          />

          <p className="hidden items-start gap-3 rounded-2xl border border-dashed p-4 text-muted-foreground wide:flex wide-xl:text-lg">
            <ScanBarcode className="mt-0.5 size-5 shrink-0" aria-hidden />
            ให้ผู้เข้าร่วมเปิด QR ตั๋วในหน้าตั๋วของฉัน (หรือบาร์โค้ดในหน้าโปรไฟล์) แล้วหันเข้ากล้องให้อยู่ในกรอบ
          </p>

          {/* Below the camera, not above it, so an error never pushes the camera down. */}
          {(participants.isError && !participants.data) || (event.isError && !event.data) ? (
            <ErrorState
              error={participants.error ?? event.error}
              onRetry={() => Promise.all([participants.refetch(), event.refetch()])}
              title="โหลดข้อมูลกิจกรรมไม่สำเร็จ"
              size="sm"
              className="w-full flex-none"
            />
          ) : null}
        </aside>
      </div>

      {(scan.outcome || scan.failure) && (
        <Result
          key={resultKey(scan.outcome, scan.failure)}
          outcome={scan.outcome}
          failure={scan.failure}
          forcing={scan.forcing}
          onForce={scan.force}
          onDismiss={() => {
            scan.clear();
            focusOnDesk(input);
          }}
        />
      )}
    </main>
  );
}

/** The result, filling the screen so people at the desk can read it from afar. */
function Result({
  outcome,
  failure,
  forcing,
  onForce,
  onDismiss,
}: {
  outcome: CheckinOutcome | null;
  failure: string | null;
  forcing: boolean;
  onForce: (userId: string) => void;
  onDismiss: () => void;
}) {
  const {
    toneClass,
    icon: Icon,
    title,
    person,
    details,
    forceable,
    forceLabel,
  } = describeResult(outcome, failure);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 p-6 text-center",
        toneClass,
      )}
      onClick={onDismiss}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter") onDismiss();
      }}
    >
      <Icon className="size-24 wide:size-32 wide-xl:size-40" aria-hidden />
      <p className="text-3xl font-semibold md:text-5xl wide-xl:text-7xl">{title}</p>
      {person && (
        <div className="flex flex-col items-center gap-2 wide-xl:gap-4">
          {person.image && (
            <img
              src={person.image}
              alt=""
              className="size-24 rounded-full border-4 border-white/70 object-cover wide:size-32 wide-xl:size-44"
            />
          )}
          <p className="text-2xl md:text-4xl wide-xl:text-6xl">
            {personName(person)}
            {person.nickname && ` (${person.nickname})`}
          </p>
          <p className="text-lg opacity-90 wide-xl:text-2xl">{details}</p>
        </div>
      )}
      {forceable && (
        <div className="flex gap-2">
          <LoadingButton
            variant="secondary"
            size="lg"
            icon={UserPlus}
            loading={forcing}
            onClick={(e) => {
              e.stopPropagation();
              onForce(forceable.userId);
            }}
          >
            {forceLabel}
          </LoadingButton>
          <Button variant="outline" size="lg" className="bg-transparent text-inherit">
            ไม่เช็คอิน
          </Button>
        </div>
      )}
      <p className="text-sm opacity-80 wide-xl:text-lg">แตะเพื่อสแกนคนถัดไป</p>
    </div>
  );
}
