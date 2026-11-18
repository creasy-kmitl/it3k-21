import { parseScan } from "@it3k/db/event-rules";
import { INSTITUTIONS } from "@it3k/db/profile";
import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  type LucideIcon,
  SwitchCamera,
  UserCheck,
  VideoOff,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { LoadingButton } from "@/components/loading-button";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import type { CheckinOutcome, CheckinTicket, Person } from "@/lib/events";
import {
  type Decoder,
  canUseCamera,
  createScanGate,
  listCameras,
  nextCamera,
  openCamera,
  saveCamera,
  savedCamera,
} from "@/lib/kiosk";

// Shared by the two ways to scan people in: the full-screen kiosk
// (/kiosk/$eventId) and the scan drawer on the staff event page.

/** How long a result stays on screen, and how long the same badge is ignored. */
export const RESULT_MS = 3500;
const SAME_CODE_MS = 5000;
const SCAN_EVERY_MS = 200;

type CameraState = "starting" | "on" | "denied" | "none";

export const personName = (person: Person) =>
  person.firstName ? `${person.prefix}${person.firstName} ${person.lastName}` : person.name;

/** A device with a mouse, where a USB scanner types into the box. */
export const isDesk = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;

/**
 * Focuses the code box on desks only: on touch screens it would open the
 * keyboard over the camera, and opening it shrinks the page under it.
 */
export function focusOnDesk(input: RefObject<HTMLInputElement | null>) {
  if (isDesk()) setTimeout(() => input.current?.focus(), 0);
}

/**
 * Scan check-in for one event: turns codes from the camera or the box into
 * check-ins, ignores the same badge twice in a row, and holds the latest
 * result until it clears itself.
 *
 * `eventKey` is what the page's queries are keyed by (a slug or an id), and
 * `id` is the event's id once it is known.
 */
export function useScanCheckIn({ eventKey, id }: { eventKey: string; id: string }) {
  const { events: api } = useApis();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<CheckinOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [gate] = useState(() => createScanGate(SAME_CODE_MS));

  const checkIn = useMutation({
    mutationFn: (vars: ({ userId: string } | { ticketCode: string }) & { force?: boolean }) =>
      api.checkIn(id, { ...vars, method: "scan" }),
    onSuccess: (result) => {
      setFailure(null);
      setOutcome(result);
    },
    onError: (error) => {
      setOutcome(null);
      setFailure(error.message);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["events", eventKey, "participants"] }),
  });

  // The camera loop calls the latest version, without restarting the camera.
  const pending = checkIn.isPending;
  const onCode = useRef<(code: string) => void>(() => {});
  onCode.current = (raw: string) => {
    if (pending) return;
    const code = gate(raw);
    // A ticket's QR, or the profile barcode (an account id).
    if (code) checkIn.mutate(parseScan(code));
  };
  const handleCode = useCallback((code: string) => onCode.current(code), []);

  // Results clear themselves, except one a manager may still force through.
  useEffect(() => {
    if (!outcome && !failure) return;
    if (outcome && "canForce" in outcome && outcome.canForce) return;
    const timer = setTimeout(() => {
      setOutcome(null);
      setFailure(null);
    }, RESULT_MS);
    return () => clearTimeout(timer);
  }, [outcome, failure]);

  const clear = useCallback(() => {
    setOutcome(null);
    setFailure(null);
  }, []);

  return {
    outcome,
    failure,
    pending,
    // Only a force in flight: a plain scan's result lands while its mutation
    // still counts as pending, which would flash a spinner on the force button.
    forcing: pending && !!checkIn.variables?.force,
    handleCode,
    force: (userId: string) => checkIn.mutate({ userId, force: true }),
    clear,
  };
}

export type ScanCheckIn = ReturnType<typeof useScanCheckIn>;

const TONES = {
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-black",
  error: "bg-destructive text-white",
} as const;

/**
 * A React key per result, so a new result mounts a new view instead of the
 * old one's text moving around (which counts as a layout shift).
 */
export const resultKey = (outcome: CheckinOutcome | null, failure: string | null) =>
  outcome
    ? `${outcome.code}:${"person" in outcome ? outcome.person.userId : ""}:${
        "ticket" in outcome ? (outcome.ticket?.id ?? "") : ""
      }`
    : `failure:${failure}`;

/** How to show a check-in result: its colour, icon, headline and the person. */
export function describeResult(outcome: CheckinOutcome | null, failure: string | null) {
  const tone =
    outcome?.code === "checked-in"
      ? "success"
      : outcome?.code === "duplicate"
        ? "warning"
        : "error";
  const icon: LucideIcon =
    tone === "success" ? CircleCheck : tone === "warning" ? CircleAlert : CircleX;
  const person = outcome && "person" in outcome ? outcome.person : null;
  const title =
    outcome?.code === "checked-in"
      ? outcome.forced
        ? "เช็คอินแล้ว (บังคับ)"
        : "เช็คอินสำเร็จ"
      : outcome?.code === "duplicate"
        ? `เช็คอินไปแล้วเมื่อ ${formatBangkok(Date.parse(outcome.checkedInAt), "time")}`
        : (outcome?.message ?? failure ?? "");
  const institution = INSTITUTIONS.find((item) => item.id === person?.institution);
  const details = person
    ? [institution?.short, person.studentId, ...person.divisions.map((d) => d.name)]
        .filter(Boolean)
        .join(" · ")
    : "";
  const forceable = outcome && "canForce" in outcome && outcome.canForce ? outcome.person : null;
  const forceLabel = "เช็คอินโดยไม่มีตั๋ว";
  const ticket = outcome && "ticket" in outcome ? outcome.ticket : null;
  return {
    tone,
    toneClass: TONES[tone],
    icon,
    title,
    person,
    details,
    ticketLabel: ticket ? ticketLabel(ticket) : null,
    forceable,
    forceLabel,
  };
}

/** "ผู้ชมทั่วไป · ใบที่ 2/3", or just the type for someone holding one ticket. */
export function ticketLabel(ticket: CheckinTicket) {
  return ticket.total > 1
    ? `${ticket.typeName} · ใบที่ ${ticket.index}/${ticket.total}`
    : ticket.typeName;
}

/** The camera preview, scanning frames while it runs, with a switch for multi-camera devices. */
export function CheckinCamera({
  decoderFactory,
  onCode,
  className,
  children,
}: {
  decoderFactory: () => Promise<Decoder>;
  onCode: (code: string) => void;
  /** Sizing for where the camera sits; the box is 16:9 unless this changes it. */
  className?: string;
  /** Laid over the camera, such as a result. */
  children?: React.ReactNode;
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
    // The box itself owns its size, and the video and the placeholder are laid
    // over it, so starting the camera never moves anything.
    <section
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-3xl border bg-muted",
        className,
      )}
    >
      <video
        ref={video}
        muted
        playsInline
        aria-label="ภาพจากกล้อง"
        className={cn("absolute inset-0 size-full object-cover", state !== "on" && "invisible")}
      />
      {state === "on" && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 aspect-[3/2] h-[72%] -translate-1/2 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]"
        />
      )}
      {state !== "on" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto p-6 text-center text-muted-foreground wide-xl:text-lg">
          <VideoOff className="size-8 wide-xl:size-12" aria-hidden />
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
      {children}
    </section>
  );
}

/** The box a USB scanner or a person types a code into. */
export function ScanForm({
  onCode,
  pending,
  input,
  keepFocused = false,
  className,
  inputClassName,
  buttonClassName,
}: {
  onCode: (code: string) => void;
  pending: boolean;
  input: RefObject<HTMLInputElement | null>;
  /** Take focus back whenever it leaves, for a kiosk desk with a scanner. */
  keepFocused?: boolean;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}) {
  const [typed, setTyped] = useState("");
  return (
    <form
      className={cn("flex gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onCode(typed);
        setTyped("");
      }}
    >
      <Input
        ref={input}
        autoComplete="off"
        aria-label="รหัสตั๋วหรือรหัสผู้ใช้"
        placeholder="สแกนด้วยเครื่องสแกน หรือพิมพ์รหัสแล้วกด Enter"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={keepFocused ? () => focusOnDesk(input) : undefined}
        className={inputClassName}
      />
      {/* An icon from the start, so the spinner swaps in without widening the button. */}
      <LoadingButton
        type="submit"
        icon={UserCheck}
        loading={pending}
        disabled={!typed.trim()}
        className={buttonClassName}
      >
        เช็คอิน
      </LoadingButton>
    </form>
  );
}
