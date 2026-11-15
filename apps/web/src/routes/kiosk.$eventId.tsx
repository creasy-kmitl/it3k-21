import { INSTITUTIONS } from "@it3k/db/profile";
import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  LogOut,
  ScanBarcode,
  SwitchCamera,
  UserCheck,
  VideoOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { LoadingButton } from "@/components/loading-button";
import { SessionBoundary } from "@/components/session-boundary";
import { useApis } from "@/lib/api-context";
import { getSessionOrThrow } from "@/lib/auth-client";
import { formatBangkok } from "@/lib/bangkok-time";
import type { CheckinOutcome, Person } from "@/lib/events";
import {
  type Decoder,
  canUseCamera,
  createDecoder,
  createScanGate,
  listCameras,
  nextCamera,
  openCamera,
  saveCamera,
  savedCamera,
} from "@/lib/kiosk";
import { clearCacheOnUserChange } from "@/lib/query-cache";
import { staffRedirect } from "./staff/route";
import { eventTime } from "./staff/events";
import { ErrorState } from "@/components/error-state";

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

/** How long a result stays on screen, and how long the same badge is ignored. */
const RESULT_MS = 3500;
const SAME_CODE_MS = 5000;
const SCAN_EVERY_MS = 200;

type CameraState = "starting" | "on" | "denied" | "none";

const personName = (person: Person) =>
  person.firstName ? `${person.prefix}${person.firstName} ${person.lastName}` : person.name;

/**
 * Full-screen check-in for one event: the camera reads the barcode on /me, a
 * USB scanner or the keyboard types into the box, and each result fills the
 * screen for a moment.
 */
export function KioskPage({
  eventId,
  decoderFactory = createDecoder,
}: {
  eventId: string;
  decoderFactory?: () => Promise<Decoder>;
}) {
  const { events: api } = useApis();
  const queryClient = useQueryClient();
  const event = useQuery({ queryKey: ["events", eventId], queryFn: () => api.get(eventId) });
  const participants = useQuery({
    queryKey: ["events", eventId, "participants"],
    queryFn: () => api.participants(eventId),
  });
  const [outcome, setOutcome] = useState<CheckinOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [gate] = useState(() => createScanGate(SAME_CODE_MS));

  const checkIn = useMutation({
    mutationFn: (vars: { userId: string; force?: boolean }) =>
      api.checkIn(eventId, { ...vars, method: "scan" }),
    onSuccess: (result) => {
      setFailure(null);
      setOutcome(result);
    },
    onError: (error) => {
      setOutcome(null);
      setFailure(error.message);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["events", eventId, "participants"] }),
  });

  // The camera loop calls the latest version, without restarting the camera.
  const pending = checkIn.isPending;
  const onCode = useRef<(code: string) => void>(() => {});
  onCode.current = (raw: string) => {
    if (pending) return;
    const code = gate(raw);
    if (code) checkIn.mutate({ userId: code });
  };
  const handleCode = useCallback((code: string) => onCode.current(code), []);

  // Results clear themselves, except one a manager may still force through.
  useEffect(() => {
    if (!outcome && !failure) return;
    if (outcome?.code === "not-listed" && outcome.canForce) return;
    const timer = setTimeout(() => {
      setOutcome(null);
      setFailure(null);
    }, RESULT_MS);
    return () => clearTimeout(timer);
  }, [outcome, failure]);

  // A desk with a USB scanner types into the box, so keep it focused there;
  // on touch screens that would keep the keyboard open over the camera, and
  // opening it on load would shrink the page under the camera.
  const keepFocus = useCallback(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) {
      setTimeout(() => input.current?.focus(), 0);
    }
  }, []);
  useEffect(keepFocus, [keepFocus]);

  const items = participants.data?.items ?? [];
  const checkedIn = items.filter((item) => item.checkin).length;
  const canCheckIn = participants.data?.canCheckIn;

  if (participants.isSuccess && !canCheckIn) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-4 text-center">
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
  return (
    <main className="flex min-h-dvh flex-col gap-4 bg-background p-4 md:p-6 wide:h-dvh wide:gap-6 wide:overflow-hidden wide:p-8 2xl:p-10">
      <header className="flex items-start gap-3 wide:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <ScanBarcode className="size-6 shrink-0 text-primary 2xl:size-9" aria-hidden />
            {event.isPending ? (
              <Skeleton className="h-7 w-48 max-w-full md:h-8 md:w-72 2xl:h-10" />
            ) : (
              <h1 className="truncate text-xl font-semibold md:text-2xl 2xl:text-4xl">
                {event.data?.name ?? "Kiosk เช็คอิน"}
              </h1>
            )}
          </div>
          <div className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground 2xl:min-h-7 2xl:text-lg">
            {event.data ? (
              <>
                <Clock className="size-4 shrink-0 2xl:size-5" aria-hidden />
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
          className="min-w-28 rounded-2xl border px-4 py-2 text-center wide:min-w-36 2xl:px-6 2xl:py-3"
          aria-live="polite"
        >
          <span className="block text-2xl font-semibold tabular-nums 2xl:text-4xl">
            {participants.data ? checkedIn : "–"}
            <span className="text-base font-normal text-muted-foreground 2xl:text-2xl">
              {" "}
              / {participants.data ? items.length : "–"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground 2xl:text-sm">เช็คอินแล้ว</span>
        </p>
        <Button
          variant="outline"
          render={<Link to="/staff/events/$eventId" params={{ eventId }} />}
          nativeButton={false}
          className="wide:h-10 wide:px-4"
        >
          <LogOut data-icon="inline-start" aria-hidden /> ออก
        </Button>
      </header>

      {/* Phones and portrait screens stack; big landscape screens put the camera beside the input. */}
      <div className="flex flex-col gap-4 wide:grid wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] wide:gap-6 2xl:grid-cols-[minmax(0,1fr)_32rem]">
        <Camera decoderFactory={decoderFactory} onCode={handleCode} />

        <aside className="mx-auto flex w-full max-w-xl flex-col gap-4 md:max-w-3xl wide:mx-0 wide:max-w-none wide:gap-6">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleCode(typed);
              setTyped("");
            }}
          >
            <Input
              ref={input}
              autoComplete="off"
              aria-label="รหัสผู้ใช้"
              placeholder="สแกนด้วยเครื่องสแกน หรือพิมพ์รหัสผู้ใช้แล้วกด Enter"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={keepFocus}
              className="wide:h-12 wide:px-4 wide:text-base 2xl:h-14 2xl:text-lg"
            />
            {/* An icon from the start, so the spinner swaps in without widening the button. */}
            <LoadingButton
              type="submit"
              icon={UserCheck}
              loading={pending}
              disabled={!typed.trim()}
              className="wide:h-12 wide:px-5 wide:text-base 2xl:h-14 2xl:text-lg"
            >
              เช็คอิน
            </LoadingButton>
          </form>

          <p className="hidden items-start gap-3 rounded-2xl border border-dashed p-4 text-muted-foreground wide:flex 2xl:text-lg">
            <ScanBarcode className="mt-0.5 size-5 shrink-0" aria-hidden />
            ให้ผู้เข้าร่วมเปิดบาร์โค้ดในหน้าโปรไฟล์ แล้วหันเข้ากล้องให้อยู่ในกรอบ
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

      {(outcome || failure) && (
        <Result
          outcome={outcome}
          failure={failure}
          forcing={pending}
          onForce={(userId) => checkIn.mutate({ userId, force: true })}
          onDismiss={() => {
            setOutcome(null);
            setFailure(null);
            keepFocus();
          }}
        />
      )}
    </main>
  );
}

/** The camera preview, scanning frames while it runs, with a switch for multi-camera devices. */
function Camera({
  decoderFactory,
  onCode,
}: {
  decoderFactory: () => Promise<Decoder>;
  onCode: (code: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const decoder = useRef<Promise<Decoder> | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(() => savedCamera());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [state, setState] = useState<CameraState>(() => (canUseCamera() ? "starting" : "none"));

  useEffect(() => {
    if (!canUseCamera()) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scan = async (read: Decoder) => {
      if (stopped) return;
      const element = video.current;
      if (element && element.readyState >= 2) {
        const code = await read(element).catch(() => null);
        if (code && !stopped) onCode(code);
      }
      timer = setTimeout(() => void scan(read), SCAN_EVERY_MS);
    };

    setState("starting");
    openCamera(deviceId)
      .then(async (opened) => {
        if (stopped) {
          for (const track of opened.getTracks()) track.stop();
          return;
        }
        stream = opened;
        const element = video.current;
        if (element) {
          element.srcObject = opened;
          await element.play().catch(() => {});
        }
        setState("on");
        setActiveId(opened.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId);
        setCameras(await listCameras());
        decoder.current ??= decoderFactory();
        void scan(await decoder.current);
      })
      .catch(() => {
        if (stopped) return;
        // A remembered camera that is gone: fall back to the default one.
        if (deviceId) setDeviceId(null);
        else setState("denied");
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [deviceId, decoderFactory, onCode]);

  return (
    // A fixed 16:9 box (or the whole column on wide screens) whether the
    // camera is on or not, so starting it moves nothing.
    <section className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border bg-muted md:max-w-3xl wide:mx-0 wide:h-full wide:max-w-none">
      <video
        ref={video}
        muted
        playsInline
        aria-label="ภาพจากกล้อง"
        className={cn(
          "aspect-video w-full object-cover wide:aspect-auto wide:h-full",
          state !== "on" && "hidden",
        )}
      />
      {state === "on" && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 aspect-[4/1] w-[76%] -translate-1/2 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]"
        />
      )}
      {state !== "on" && (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground wide:aspect-auto wide:h-full 2xl:text-lg">
          <VideoOff className="size-8 2xl:size-12" aria-hidden />
          <p>
            {state === "starting"
              ? "กำลังเปิดกล้อง"
              : state === "denied"
                ? "เปิดกล้องไม่ได้ อนุญาตการใช้กล้องในเบราว์เซอร์ หรือใช้เครื่องสแกนด้านล่าง"
                : "อุปกรณ์นี้ไม่มีกล้อง ใช้เครื่องสแกนหรือพิมพ์รหัสด้านล่าง"}
          </p>
        </div>
      )}
      {cameras.length > 1 && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-3 right-3"
          aria-label="สลับกล้อง"
          onClick={() => {
            const next = nextCamera(cameras, activeId);
            if (!next) return;
            saveCamera(next);
            setDeviceId(next);
          }}
        >
          <SwitchCamera />
        </Button>
      )}
    </section>
  );
}

const TONES = {
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-black",
  error: "bg-destructive text-white",
} as const;

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
  const tone =
    outcome?.code === "checked-in"
      ? "success"
      : outcome?.code === "duplicate"
        ? "warning"
        : "error";
  const Icon = tone === "success" ? CircleCheck : tone === "warning" ? CircleAlert : CircleX;
  const person = outcome && "person" in outcome ? outcome.person : null;
  const title =
    outcome?.code === "checked-in"
      ? outcome.forced
        ? "เช็คอินแล้ว (นอกรายชื่อ)"
        : "เช็คอินสำเร็จ"
      : outcome?.code === "duplicate"
        ? `เช็คอินไปแล้วเมื่อ ${formatBangkok(Date.parse(outcome.checkedInAt), "time")}`
        : (outcome?.message ?? failure ?? "");
  const institution = INSTITUTIONS.find((item) => item.id === person?.institution);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 p-6 text-center",
        TONES[tone],
      )}
      onClick={onDismiss}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter") onDismiss();
      }}
    >
      <Icon className="size-24 wide:size-32 2xl:size-40" aria-hidden />
      <p className="text-3xl font-semibold md:text-5xl 2xl:text-7xl">{title}</p>
      {person && (
        <div className="flex flex-col items-center gap-2 2xl:gap-4">
          {person.image && (
            <img
              src={person.image}
              alt=""
              className="size-24 rounded-full border-4 border-white/70 object-cover wide:size-32 2xl:size-44"
            />
          )}
          <p className="text-2xl md:text-4xl 2xl:text-6xl">
            {personName(person)}
            {person.nickname && ` (${person.nickname})`}
          </p>
          <p className="text-lg opacity-90 2xl:text-2xl">
            {[institution?.short, person.studentId, ...person.divisions.map((d) => d.name)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
      {outcome?.code === "not-listed" && outcome.canForce && (
        <div className="flex gap-2">
          <LoadingButton
            variant="secondary"
            size="lg"
            loading={forcing}
            onClick={(e) => {
              e.stopPropagation();
              onForce(outcome.person.userId);
            }}
          >
            เช็คอินนอกรายชื่อ
          </LoadingButton>
          <Button variant="outline" size="lg" className="bg-transparent text-inherit">
            ไม่เช็คอิน
          </Button>
        </div>
      )}
      <p className="text-sm opacity-80 2xl:text-lg">แตะเพื่อสแกนคนถัดไป</p>
    </div>
  );
}
