import { INSTITUTIONS } from "@it3k/db/profile";
import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
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
  VideoOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SessionBoundary } from "@/components/session-boundary";
import { useApis } from "@/lib/api-context";
import { authClient } from "@/lib/auth-client";
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

export const Route = createFileRoute("/kiosk/$eventId")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await authClient.getSession();
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
  // on touch screens that would keep the keyboard open over the camera.
  const keepFocus = () => {
    if (window.matchMedia?.("(pointer: fine)").matches) {
      setTimeout(() => input.current?.focus(), 0);
    }
  };

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

  return (
    <main className="flex min-h-dvh flex-col gap-4 bg-background p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
            <ScanBarcode className="size-6 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{event.data?.name ?? "Kiosk เช็คอิน"}</span>
          </h1>
          {event.data && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden />
              {eventTime(event.data)}
              {event.data.venue && ` · ${event.data.venue.name}`}
            </p>
          )}
        </div>
        <p className="rounded-2xl border px-4 py-2 text-center" aria-live="polite">
          <span className="block text-2xl font-semibold tabular-nums">
            {checkedIn}
            <span className="text-base font-normal text-muted-foreground"> / {items.length}</span>
          </span>
          <span className="text-xs text-muted-foreground">เช็คอินแล้ว</span>
        </p>
        <Button
          variant="outline"
          render={<Link to="/staff/events/$eventId" params={{ eventId }} />}
          nativeButton={false}
        >
          <LogOut data-icon="inline-start" aria-hidden /> ออก
        </Button>
      </header>

      <Camera decoderFactory={decoderFactory} onCode={handleCode} />

      <form
        className="mx-auto flex w-full max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleCode(typed);
          setTyped("");
        }}
      >
        <Input
          ref={input}
          autoFocus
          autoComplete="off"
          aria-label="รหัสผู้ใช้"
          placeholder="สแกนด้วยเครื่องสแกน หรือพิมพ์รหัสผู้ใช้แล้วกด Enter"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={keepFocus}
        />
        <Button type="submit" disabled={pending || !typed.trim()}>
          เช็คอิน
        </Button>
      </form>

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
    <section className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border bg-muted">
      <video
        ref={video}
        muted
        playsInline
        aria-label="ภาพจากกล้อง"
        className={cn("aspect-video w-full object-cover", state !== "on" && "hidden")}
      />
      {state === "on" && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[12%] top-1/2 h-1/3 -translate-y-1/2 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]"
        />
      )}
      {state !== "on" && (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <VideoOff className="size-8" aria-hidden />
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
      <Icon className="size-24" aria-hidden />
      <p className="text-3xl font-semibold md:text-5xl">{title}</p>
      {person && (
        <div className="flex flex-col items-center gap-2">
          {person.image && (
            <img
              src={person.image}
              alt=""
              className="size-24 rounded-full border-4 border-white/70 object-cover"
            />
          )}
          <p className="text-2xl md:text-4xl">
            {personName(person)}
            {person.nickname && ` (${person.nickname})`}
          </p>
          <p className="text-lg opacity-90">
            {[institution?.short, person.studentId, ...person.divisions.map((d) => d.name)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
      {outcome?.code === "not-listed" && outcome.canForce && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="lg"
            disabled={forcing}
            onClick={(e) => {
              e.stopPropagation();
              onForce(outcome.person.userId);
            }}
          >
            เช็คอินนอกรายชื่อ
          </Button>
          <Button variant="outline" size="lg" className="bg-transparent text-inherit">
            ไม่เช็คอิน
          </Button>
        </div>
      )}
      <p className="text-sm opacity-80">แตะเพื่อสแกนคนถัดไป</p>
    </div>
  );
}
