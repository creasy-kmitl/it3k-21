import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { CLAIM_REFUSALS, TICKETS_KEY, claimRefusal } from "@/lib/tickets";

/** Claims one ticket of a type to `event`, then refreshes every ticket query. */
export function useClaimTicket(event: { id: string; name: string }) {
  const { tickets } = useApis();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: { id: string; name: string }) => tickets.claim(event.id, type.id),
    onSuccess: (_data, type) => toast.success(`รับตั๋ว ${type.name} · ${event.name} แล้ว`),
    onError: (error) => {
      const refusal = claimRefusal(error);
      if (refusal) toast.error(CLAIM_REFUSALS[refusal]);
      else toastError(error, "รับตั๋วไม่สำเร็จ");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
  });
}

/** Seats left, with a bar that fills as tickets go. */
export function Seats({
  capacity,
  remaining,
}: {
  capacity: number | null;
  remaining: number | null;
}) {
  if (capacity === null || remaining === null) {
    return <p className="text-sm text-muted-foreground">ไม่จำกัดจำนวน</p>;
  }
  const taken = capacity - remaining;
  const low = remaining > 0 && remaining <= Math.max(5, capacity * 0.1);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex justify-between text-sm">
        <span className={cn(low ? "font-medium text-amber-600" : "text-muted-foreground")}>
          {remaining === 0
            ? "เต็มแล้ว"
            : low
              ? `เหลือเพียง ${remaining.toLocaleString("th-TH")} ที่`
              : `เหลือ ${remaining.toLocaleString("th-TH")} ที่`}
        </span>
        <span className="text-muted-foreground">
          {taken.toLocaleString("th-TH")}/{capacity.toLocaleString("th-TH")}
        </span>
      </p>
      <div
        role="progressbar"
        aria-label="ตั๋วที่รับไปแล้ว"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={taken}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full",
            remaining === 0 ? "bg-muted-foreground" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, (taken / capacity) * 100)}%` }}
        />
      </div>
    </div>
  );
}
