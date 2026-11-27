import { cn } from "@it3k/ui/lib/utils";
import { useEffect, useRef, useState } from "react";

/** A CODE128 barcode of `value`, drawn by jsbarcode once it loads. */
export function Barcode({
  value,
  label,
  height = 48,
  width = 2,
  className,
}: {
  value: string;
  /** What a screen reader says for the picture. */
  label: string;
  height?: number;
  width?: number;
  className?: string;
}) {
  const element = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import("jsbarcode")
      .then(({ default: barcode }) => {
        if (active && element.current)
          barcode(element.current, value, {
            format: "CODE128",
            height,
            width,
            margin: 12,
            displayValue: false,
          });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value, height, width]);
  return failed ? (
    <p className="text-sm text-muted-foreground">แสดงบาร์โค้ดไม่สำเร็จ</p>
  ) : (
    <div className={cn("overflow-x-auto rounded-xl", className)}>
      <svg ref={element} role="img" aria-label={label} className="h-auto max-w-full" />
    </div>
  );
}

/** The account id as a barcode, which the event kiosk reads. */
export function UserBarcode({ id }: { id: string }) {
  return <Barcode value={id} label={`บาร์โค้ดรหัสผู้ใช้ ${id}`} />;
}
