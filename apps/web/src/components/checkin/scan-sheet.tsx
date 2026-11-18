import { Button } from "@it3k/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@it3k/ui/components/sheet";
import { cn } from "@it3k/ui/lib/utils";
import { UserPlus } from "lucide-react";
import { useRef } from "react";

import { LoadingButton } from "@/components/loading-button";
import type { Decoder } from "@/lib/kiosk";

import {
  CheckinCamera,
  ScanForm,
  type ScanCheckIn,
  describeResult,
  focusOnDesk,
  isDesk,
  personName,
  resultKey,
  useScanCheckIn,
} from "./scan-checkin";

/**
 * Scan mode: check people in from the staff event page without leaving it.
 * The camera runs only while the drawer is open, and the list behind it
 * updates as people check in. The kiosk is the full-screen mode for a desk.
 */
export function ScanSheet({
  open,
  onOpenChange,
  eventKey,
  id,
  eventName,
  counts,
  decoderFactory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventKey: string;
  id: string;
  eventName?: string;
  counts?: { checkedIn: number; total: number };
  decoderFactory: () => Promise<Decoder>;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={popup}
        // A desk scanner types into the box straight away; on a phone, focusing
        // it would open the keyboard over the camera.
        initialFocus={() => (isDesk() ? input.current : popup.current)}
        className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="pr-14">
          <SheetTitle>สแกนเช็คอิน</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="truncate">{eventName ?? "กิจกรรม"}</span>
            {/* A fixed-width count, so the header never jumps as it changes. */}
            <span className="min-w-24 text-right tabular-nums" aria-live="polite">
              เช็คอินแล้ว {counts ? `${counts.checkedIn} / ${counts.total}` : "– / –"}
            </span>
          </SheetDescription>
        </SheetHeader>
        {/* Mounted only while open, so closing the drawer stops the camera. */}
        {open && (
          <ScanBody eventKey={eventKey} id={id} input={input} decoderFactory={decoderFactory} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScanBody({
  eventKey,
  id,
  input,
  decoderFactory,
}: {
  eventKey: string;
  id: string;
  input: React.RefObject<HTMLInputElement | null>;
  decoderFactory: () => Promise<Decoder>;
}) {
  const scan = useScanCheckIn({ eventKey, id });
  return (
    <div className="flex flex-col gap-4 px-6 pb-6">
      {/* Taller on phones, where the drawer is narrow and has room below. */}
      <CheckinCamera
        decoderFactory={decoderFactory}
        onCode={scan.handleCode}
        className="aspect-[4/3] sm:aspect-video"
      >
        {(scan.outcome || scan.failure) && (
          <ResultCard
            key={resultKey(scan.outcome, scan.failure)}
            scan={scan}
            onDismiss={() => {
              scan.clear();
              focusOnDesk(input);
            }}
          />
        )}
      </CheckinCamera>
      <ScanForm onCode={scan.handleCode} pending={scan.pending} input={input} />
      <p className="text-muted-foreground">
        ให้ผู้เข้าร่วมเปิด QR ตั๋วในหน้าตั๋วของฉัน (หรือบาร์โค้ดในหน้าโปรไฟล์) แล้วหันเข้ากล้องให้อยู่ในกรอบ
      </p>
    </div>
  );
}

/**
 * The result, laid over the camera rather than above or below it, so it
 * never pushes the camera or the box around.
 */
function ResultCard({ scan, onDismiss }: { scan: ScanCheckIn; onDismiss: () => void }) {
  const {
    toneClass,
    icon: Icon,
    title,
    person,
    details,
    ticketLabel,
    forceable,
    forceLabel,
  } = describeResult(scan.outcome, scan.failure);
  return (
    <div
      role="status"
      aria-label={title}
      className={cn(
        // safe-center: if it ever outgrows the box, it scrolls instead of losing its top.
        "absolute inset-0 flex flex-col items-center justify-center-safe gap-1 overflow-y-auto p-4 text-center",
        toneClass,
      )}
    >
      <Icon className="size-10 shrink-0" aria-hidden />
      <p className="text-lg font-semibold">{title}</p>
      {person && (
        <>
          <p className="font-medium">
            {personName(person)}
            {person.nickname && ` (${person.nickname})`}
          </p>
          {details && <p className="text-sm opacity-90">{details}</p>}
          {ticketLabel && (
            <p className="mt-1 rounded-full bg-black/15 px-3 py-0.5 text-sm font-medium">
              {ticketLabel}
            </p>
          )}
        </>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {forceable && (
          <LoadingButton
            variant="secondary"
            size="sm"
            icon={UserPlus}
            loading={scan.forcing}
            onClick={() => scan.force(forceable.userId)}
          >
            {forceLabel}
          </LoadingButton>
        )}
        <Button
          variant="outline"
          size="sm"
          className="border-current bg-transparent text-inherit hover:bg-white/15 hover:text-inherit"
          onClick={onDismiss}
        >
          {forceable ? "ไม่เช็คอิน" : "สแกนคนถัดไป"}
        </Button>
      </div>
    </div>
  );
}
