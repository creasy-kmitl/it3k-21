import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { CircleCheck, LogOut, ScanBarcode } from "lucide-react";
import { useEffect, useRef } from "react";

import { CheckinCamera, ScanForm, focusOnDesk } from "@/components/checkin/scan-checkin";
import { MatchCheckinCard } from "@/components/competition/checkin/match-checkin-card";
import {
  ScanResult,
  matchCheckinKey,
  scanKey,
  useMatchScan,
} from "@/components/competition/checkin/scan-result";
import { ErrorState } from "@/components/error-state";
import { SessionBoundary } from "@/components/session-boundary";
import { useApis } from "@/lib/api-context";
import { getSessionOrThrow } from "@/lib/auth-client";
import type { RosterSide } from "@/lib/competition-checkins";
import { type Decoder, createDecoder } from "@/lib/kiosk";
import { ApiError } from "@/lib/leadership";
import { clearCacheOnUserChange } from "@/lib/query-cache";
import { staffRedirect } from "./staff/route";

export const Route = createFileRoute("/kiosk/matches/$matchId")({
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
  const { matchId } = Route.useParams();
  return (
    <SessionBoundary key={session.data?.user.id} userId={session.data?.user.id ?? ""}>
      <MatchKioskPage matchId={matchId} />
    </SessionBoundary>
  );
}

/** How often the kiosk refreshes its counts and its window. */
const REFRESH_MS = 15_000;

/**
 * Full-screen check-in for one match: athletes hold the six-digit sport
 * check-in code on /me to the camera (or a USB scanner reads it into the box).
 * The match stays on screen with each side's count against the minimum and
 * who has reported in, and each result fills the screen for a moment.
 */
export function MatchKioskPage({
  matchId,
  decoderFactory = createDecoder,
}: {
  matchId: string;
  decoderFactory?: () => Promise<Decoder>;
}) {
  const { competitionCheckins: api } = useApis();
  const state = useQuery({
    queryKey: matchCheckinKey(matchId),
    queryFn: () => api.match(matchId),
    refetchInterval: REFRESH_MS,
  });
  const scan = useMatchScan(matchId);
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

  const match = state.data?.match ?? null;

  return (
    <main className="flex min-h-dvh w-full min-w-0 flex-col gap-4 bg-background p-4 md:p-6 wide:h-dvh wide:gap-6 wide:overflow-hidden wide:p-8 wide-xl:p-10">
      <header className="flex items-start gap-3 wide:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ScanBarcode className="size-6 shrink-0 text-primary wide-xl:size-9" aria-hidden />
          <h1 className="truncate text-xl font-semibold md:text-2xl wide-xl:text-4xl">
            รายงานตัวแข่งขัน
          </h1>
        </div>
        <Button
          variant="outline"
          render={<Link to="/staff/matches/$matchId" params={{ matchId }} />}
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
            label="รหัสเช็คอินกีฬา"
            className="mx-auto w-full max-w-xl md:max-w-3xl wide:mx-0 wide:max-w-none"
            inputClassName="wide:h-12 wide:px-4 wide:text-base wide-xl:h-14 wide-xl:text-lg"
            buttonClassName="wide:h-12 wide:px-5 wide:text-base wide-xl:h-14 wide-xl:text-lg"
          />
          <p className="mx-auto flex w-full max-w-xl items-start gap-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground md:max-w-3xl wide:mx-0 wide:max-w-none wide-xl:text-lg">
            <ScanBarcode className="mt-0.5 size-5 shrink-0" aria-hidden />
            ให้นักกีฬาเปิดรหัสเช็คอินกีฬา 6 หลักในหน้าโปรไฟล์ แล้วหันบาร์โค้ดเข้ากล้อง
          </p>
        </div>

        <aside
          className="mx-auto flex w-full max-w-xl flex-col gap-3 md:max-w-3xl wide:mx-0 wide:max-w-none wide:min-h-0 wide:overflow-y-auto wide-xl:gap-4"
          aria-label="แมตช์นี้"
          aria-live="polite"
        >
          {state.isPending ? (
            <>
              <Skeleton className="h-36 rounded-3xl" />
              <Skeleton className="h-48 rounded-3xl" />
            </>
          ) : !match ? (
            <ErrorState
              error={state.error}
              onRetry={() => state.refetch()}
              title="โหลดแมตช์ไม่สำเร็จ"
              size="sm"
              className="w-full flex-none"
            />
          ) : (
            <>
              <MatchCheckinCard match={match} size="lg" />
              {match.sides.map((side) => (
                <KioskRoster key={side.participantId} side={side} />
              ))}
            </>
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

/** A side's players as the athletes see them at the kiosk: who has reported in. */
function KioskRoster({ side }: { side: RosterSide }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-3xl border p-4 wide-xl:p-6"
      aria-label={`รายชื่อ ${side.label}`}
    >
      <h2 className="font-semibold wide-xl:text-2xl">{side.label}</h2>
      {side.roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีรายชื่อ</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {side.roster.map((entry) => (
            <li
              key={entry.userId}
              className={cn(
                "flex items-center gap-2 wide-xl:text-xl",
                !entry.checkin && "text-muted-foreground",
              )}
            >
              <CircleCheck
                className={cn(
                  "size-4 shrink-0 wide-xl:size-6",
                  entry.checkin ? "text-emerald-600" : "opacity-25",
                )}
                aria-label={entry.checkin ? "รายงานตัวแล้ว" : "ยังไม่รายงานตัว"}
              />
              <span className="w-8 shrink-0 tabular-nums">
                {entry.shirtNumber !== null ? `#${entry.shirtNumber}` : ""}
              </span>
              <span className="min-w-0 truncate">{entry.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
