import { Button } from "@it3k/ui/components/button";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";

/** Shown in place of a page whose loader or render failed, with a way to try again. */
export default function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <div role="alert" className="flex flex-1 flex-col items-start gap-2 p-4 text-destructive">
      <p>โหลดหน้านี้ไม่สำเร็จ: {error instanceof Error ? error.message : String(error)}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        ลองอีกครั้ง
      </Button>
    </div>
  );
}
