import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

import { DepartmentIcon } from "@/components/department-icon";
import { useApis } from "@/lib/api-context";
import { DAY_MS, dateKey, formatBangkok, formatRange } from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";
import { STATUS_LABELS } from "@/lib/calendar-labels";

const LOOK_AHEAD_MS = 7 * DAY_MS;
const LIMIT = 5;
/** Queries are keyed on now rounded down, so they refresh without refetching every render. */
const ROUND_MS = 5 * 60 * 1000;

/** What is on now or next in the department, soonest first, without cancellations. */
export function upcoming(items: CalendarItem[], now: number) {
  return items
    .filter((item) => item.status !== "cancelled" && item.endAt > now)
    .sort((a, b) => a.startAt - b.startAt)
    .slice(0, LIMIT);
}

/** The next few items on the viewer's department calendar, linking into it. */
export function Upcoming({ now, departmentId }: { now: number; departmentId: string | null }) {
  const { calendar } = useApis();
  const anchor = Math.floor(now / ROUND_MS) * ROUND_MS;
  const range = {
    from: anchor,
    to: anchor + LOOK_AHEAD_MS,
    departmentIds: departmentId ? [departmentId] : undefined,
  };
  const items = useQuery({
    queryKey: ["calendar", "items", range],
    queryFn: () => calendar.list(range),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const next = upcoming(items.data?.items ?? [], now);
  const title = departmentId ? "กำหนดการของแผนกใน 7 วัน" : "กำหนดการใน 7 วัน";

  return (
    <section className="flex flex-col gap-3 rounded-2xl border p-4" aria-label={title}>
      <h2 className="flex items-center gap-2 font-semibold">
        <CalendarClock aria-hidden className="size-4 text-primary" />
        {title}
      </h2>
      {items.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="กำลังโหลด">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : items.isError && !items.data ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          โหลดกำหนดการไม่สำเร็จ
          <Button variant="outline" size="sm" onClick={() => void items.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : next.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีรายการ</p>
      ) : (
        <ul className="flex flex-col">
          {next.map((item) => (
            <li key={item.id}>
              <Link
                to="/staff/calendar"
                search={{ view: "day", date: dateKey(item.startAt), item: item.id }}
                className="flex w-full items-start gap-2 rounded-lg p-1 text-left hover:bg-muted/60"
              >
                <DepartmentIcon department={item.department} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBangkok(item.startAt, "day")} {formatRange(item.startAt, item.endAt)}
                    {item.status === "draft" && ` · ${STATUS_LABELS.draft}`}
                    {item.venue && ` · ${item.venue}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
