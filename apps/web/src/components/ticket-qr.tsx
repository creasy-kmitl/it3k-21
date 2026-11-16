import { TICKET_QR_PREFIX } from "@it3k/db/event-rules";
import { cn } from "@it3k/ui/lib/utils";
import { useMemo } from "react";

import { DEFAULT_DESIGN, type QrDesign, encodeQr, renderQrSvg, svgDataUrl } from "@/lib/qr";

// Plain square modules and a wide quiet zone: a phone screen held up to a
// kiosk camera is glare, tilt and distance, so nothing fancy.
const TICKET_DESIGN: QrDesign = {
  ...DEFAULT_DESIGN,
  markerBorder: "square",
  markerCenter: "square",
  quietZone: 4,
  ecc: "M",
};

/** What a ticket's QR encodes. */
export const ticketQrText = (code: string) => `${TICKET_QR_PREFIX}${code}`;

export function TicketQr({
  code,
  label,
  className,
}: {
  code: string;
  label: string;
  className?: string;
}) {
  const svg = useMemo(() => {
    const encoded = encodeQr(ticketQrText(code), TICKET_DESIGN.ecc);
    return encoded.ok ? renderQrSvg(encoded.qr, TICKET_DESIGN, 512) : null;
  }, [code]);
  if (!svg) return <p className="text-sm text-muted-foreground">แสดง QR ไม่สำเร็จ</p>;
  return (
    <img
      src={svgDataUrl(svg)}
      alt={label}
      className={cn(
        "aspect-square w-full max-w-64 rounded-lg bg-white [image-rendering:pixelated]",
        className,
      )}
    />
  );
}
