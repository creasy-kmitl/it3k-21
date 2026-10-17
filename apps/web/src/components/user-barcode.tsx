import { useEffect, useRef, useState } from "react";

export function UserBarcode({ id }: { id: string }) {
  const element = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import("jsbarcode")
      .then(({ default: barcode }) => {
        if (active && element.current)
          barcode(element.current, id, {
            format: "CODE128",
            height: 48,
            width: 2,
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
  }, [id]);
  return failed ? (
    <p className="text-sm text-muted-foreground">แสดงบาร์โค้ดไม่สำเร็จ</p>
  ) : (
    <div className="overflow-x-auto rounded-xl">
      <svg
        ref={element}
        role="img"
        aria-label={`บาร์โค้ดรหัสผู้ใช้ ${id}`}
        className="h-auto max-w-full"
      />
    </div>
  );
}
