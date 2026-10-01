import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { CircleCheck, CirclePause, Copy, Hourglass, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import type { LinkState } from "@/lib/links";
import { copyText } from "@/lib/qr-export";

const STATES: Record<LinkState, { label: string; icon: LucideIcon; className: string }> = {
  active: {
    label: "ใช้งานอยู่",
    icon: CircleCheck,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  disabled: { label: "ปิดอยู่", icon: CirclePause, className: "bg-muted text-muted-foreground" },
  expired: {
    label: "หมดอายุ",
    icon: Hourglass,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
};

export function LinkStateBadge({ state }: { state: LinkState }) {
  const { label, icon: Icon, className } = STATES[state];
  return (
    <Badge variant="secondary" className={cn("shrink-0", className)}>
      <Icon aria-hidden data-icon="inline-start" />
      {label}
    </Badge>
  );
}

/** A URL without its scheme, which is how people read and type it. */
export const displayUrl = (url: string) => url.replace(/^https?:\/\//, "");

export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  /** What is copied, for screen readers and the toast, e.g. "ลิงก์สำหรับ QR". */
  label: string;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`คัดลอก${label}`}
      className={className}
      onClick={async () => {
        if (await copyText(text).catch(() => false)) toast.success(`คัดลอก${label}แล้ว`);
        else toast.error("เบราว์เซอร์นี้คัดลอกไม่ได้ ลองเลือกข้อความแล้วคัดลอกเอง");
      }}
    >
      <Copy />
    </Button>
  );
}
