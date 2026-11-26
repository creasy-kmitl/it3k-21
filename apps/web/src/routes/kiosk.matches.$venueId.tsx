import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { CalendarClock, LogOut, MapPin, ScanBarcode } from "lucide-react";
import { useEffect, useRef } from "react";

import { CheckinCamera, ScanForm, focusOnDesk } from "@/components/checkin/scan-checkin";
import {
  MatchCheckinCard,
  matchTitle,
  windowLabel,
} from "@/components/competition/checkin/match-checkin-card";
import {
  ScanResult,
  scanKey,
  useMatchScan,
  venueKey,
} from "@/components/competition/checkin/scan-result";
import { ErrorState } from "@/components/error-state";
import { SessionBoundary } from "@/components/session-boundary";
import { useApis } from "@/lib/api-context";
import { getSessionOrThrow } from "@/lib/auth-client";
import { type Decoder, createDecoder } from "@/lib/kiosk";
import { ApiError } from "@/lib/leadership";
import { clearCacheOnUserChange } from "@/lib/query-cache";
import { staffRedirect } from "./staff/route";

export const Route = createFileRoute("/kiosk/matches/$venueId")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await getSessionOrThrow();
    clearCacheOnUserChange(context.queryClient, session.data?.user.id ?? null);
    const away = staffRedirect(session.data?.user, location.href);
    if (away) throw redirect(away);
    return { session };
  },
  head: () => ({
    meta: [{ title: "Kiosk รายงานตัวแข่งขัน · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const { venueId } = Route.useParams();
  return (
    <SessionBoundary key={session.data?.user.id} userId={session.data?.user.id ?? ""}>
      <MatchKioskPage venueId={venueId} />
    </SessionBoundary>
  );
}

/** How often the kiosk refreshes its counts and which matches are open. */
const REFRESH_MS = 15_000;

/**
 * Full-screen check-in at one venue: athletes hold the barcode on /me to the
 * camera (or a USB scanner reads it into the box) and are checked in to their
 * next match here. The matches open now stay on screen with each side's count
 * against the minimum, and each result fills the screen for a moment.
 */
export function MatchKioskPage({
  venueId,
  decoderFactory = createDecoder,
}: {
  venueId: string;
  decoderFactory?: () => Promise<Decoder>;
}) {
  const { competitionCheckins: api } = useApis();
  const state = useQuery({
    queryKey: venueKey(venueId),
    queryFn: () => api.venue(venueId),
    refetchInterval: REFRESH_MS,
  });
  const scan = useMatchScan(venueId);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => focusOnDesk(input), []);

  if (state.error instanceof ApiError && state.error.status === 403) {
    return (
      <main className="flex min-h-dvh w-full min-w-0 flex-col items-center justify-center gap-4 bg-background p-4 text-center">
        <p role="alert" className="text-lg">
          บัญชีนี้ไม่มีสิทธิ์ใช้ Kiosk รายงานตัวแข่งขัน
        </p>
        <Button render={<Link to="/staff" />} nativeButton={false} variant="outline">
          กลับ
        </Button>
      </main>
    );
  }

  const matches = state.data?.matches ?? [];
  const next = state.data?.next ?? null;

  return (
    <main className="flex min-h-dvh w-full min-w-0 flex-col gap-4 bg-background p-4 md:p-6 wide:h-dvh wide:gap-6 wide:overflow-hidden wide:p-8 wide-xl:p-10">
      <header className="flex items-start gap-3 wide:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <ScanBarcode className="size-6 shrink-0 text-primary wide-xl:size-9" aria-hidden />
            <h1 className="truncate text-xl font-semibold md:text-2xl wide-xl:text-4xl">
              รายงานตัวแข่งขัน
            </h1>
          </div>
          <div className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground wide-xl:min-h-7 wide-xl:text-lg">
            {state.data ? (
              <>
                <MapPin className="size-4 shrink-0 wide-xl:size-5" aria-hidden />
                <p className="min-w-0 truncate">{state.data.venue.name}</p>
              </>
            ) : (
              state.isPending && <Skeleton className="h-4 w-40 max-w-full" />
            )}
          </div>
        </div>
        <Button
          variant="outline"
          render={<Link to="/staff/match-checkin" search={{ venue: venueId }} />}
          nativeButton={false}
          className="wide:h-10 wide:px-4"
        >
          <LogOut data-icon="inline-start" aria-hidden /> ออก
        </Button>
      </header>

      <div className="flex flex-col gap-4 wide:grid wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] wide:gap-6 wide-xl:grid-cols-[minmax(0,1fr)_38rem]">
        <div className="flex flex-col gap-4 wide:min-h-0">
          <CheckinCamera
            decoderFactory={decoderFactory}
            onCode={scan.handleCode}
            className="mx-auto max-w-xl md:max-w-3xl wide:mx-0 wide:aspect-auto wide:min-h-0 wide:max-w-none wide:flex-1"
          />
          <ScanForm
            onCode={scan.handleCode}
            pending={scan.pending}
            input={input}
            keepFocused
            className="mx-auto w-full max-w-xl md:max-w-3xl wide:mx-0 wide:max-w-none"
            inputClassName="wide:h-12 wide:px-4 wide:text-base wide-xl:h-14 wide-xl:text-lg"
            buttonClassName="wide:h-12 wide:px-5 wide:text-base wide-xl:h-14 wide-xl:text-lg"
          />
          <p className="mx-auto flex w-full max-w-xl items-start gap-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground md:max-w-3xl wide:mx-0 wide:max-w-none wide-xl:text-lg">
            <ScanBarcode className="mt-0.5 size-5 shrink-0" aria-hidden />
            ให้นักกีฬาเปิดบาร์โค้ดในหน้าโปรไฟล์ (ไม่ใช่ QR ตั๋วกิจกรรม) แล้วหันเข้ากล้อง
          </p>
        </div>

        <aside
          className="mx-auto flex w-full max-w-xl flex-col gap-3 md:max-w-3xl wide:mx-0 wide:max-w-none wide:min-h-0 wide:overflow-y-auto wide-xl:gap-4"
          aria-label="แมตช์ที่รายงานตัวได้ตอนนี้"
          aria-live="polite"
        >
          {state.isPending ? (
            <>
              <Skeleton className="h-36 rounded-3xl" />
              <Skeleton className="h-36 rounded-3xl" />
            </>
          ) : state.isError && !state.data ? (
            <ErrorState
              error={state.error}
              onRetry={() => state.refetch()}
              title="โหลดแมตช์ของสนามนี้ไม่สำเร็จ"
              size="sm"
              className="w-full flex-none"
            />
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed p-8 text-center text-muted-foreground wide-xl:text-xl">
              <CalendarClock className="size-10" aria-hidden />
              <p className="font-medium text-foreground">ยังไม่มีแมตช์ที่เปิดรายงานตัว</p>
              {next && (
                <p>
                  ถัดไป: {matchTitle(next)} · {windowLabel(next.window)}
                </p>
              )}
            </div>
          ) : (
            matches.map((match) => <MatchCheckinCard key={match.id} match={match} size="lg" />)
          )}
        </aside>
      </div>

      {(scan.outcome || scan.failure) && (
        <ScanResult
          key={scanKey(scan.outcome, scan.failure)}
          outcome={scan.outcome}
          failure={scan.failure}
          onDismiss={() => {
            scan.clear();
            focusOnDesk(input);
          }}
        />
      )}
    </main>
  );
}
