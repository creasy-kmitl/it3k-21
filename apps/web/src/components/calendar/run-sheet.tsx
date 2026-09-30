import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useApis } from "@/lib/api-context";
import { HOUR_MS, dateKey, formatBangkok, formatRange } from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";
import { LIVE_CATEGORIES, LIVE_CHECKLIST_SIZE, MODE_STYLES } from "@/lib/calendar-labels";

import { ItemFlags } from "./item-chip";

const LOOK_BACK_MS = 12 * HOUR_MS;
const LOOK_AHEAD_MS = 48 * HOUR_MS;
/** Queries are keyed on now rounded down, so they refresh without refetching every render. */
const ROUND_MS = 5 * 60 * 1000;

const active = (item: CalendarItem) => item.status !== "cancelled" && item.archivedAt === null;
const isLive = (item: CalendarItem) =>
  LIVE_CATEGORIES.includes(item.category) || item.status === "live";
const isMeeting = (item: CalendarItem) =>
  item.mode === "meetings" || item.category === "cross_team_meeting" || item.category === "handoff";

export type RunSheetSummary = {
  liveNow: CalendarItem[];
  nextLive: CalendarItem | null;
  nextMeeting: CalendarItem | null;
  nextRelease: CalendarItem | null;
  blockers: CalendarItem[];
};

/** Today's run sheet: what is live, what is next, and what is stuck. */
export function summarize(items: CalendarItem[], now: number): RunSheetSummary {
  const current = items.filter(active);
  const upcoming = current
    .filter((item) => item.startAt > now)
    .sort((a, b) => a.startAt - b.startAt);
  return {
    liveNow: current.filter((item) => isLive(item) && item.startAt <= now && item.endAt > now),
    nextLive: upcoming.find(isLive) ?? null,
    nextMeeting: upcoming.find(isMeeting) ?? null,
    nextRelease: upcoming.find((item) => item.category === "release") ?? null,
    blockers: current.filter(
      (item) => item.endAt > now && (item.blockedReason !== null || item.riskLevel === "high"),
    ),
  };
}

const ENTRY = "flex w-full items-start gap-2 rounded-lg p-1 text-left hover:bg-muted/60";

function Entry({ item, onSelect }: { item: CalendarItem; onSelect?: (itemId: string) => void }) {
  const content = (
    <>
      <span
        aria-hidden
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", MODE_STYLES[item.mode].dot)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-1.5 font-medium">
          {item.title}
          <ItemFlags item={item} />
        </span>
        <span className="text-xs text-muted-foreground">
          {formatBangkok(item.startAt, "day")} {formatRange(item.startAt, item.endAt)}
          {item.owner && ` · ${item.owner.name}`}
        </span>
        {item.checklistDone !== null && (
          <span
            className={cn(
              "text-xs",
              item.checklistDone < LIVE_CHECKLIST_SIZE || !item.onCallOwner
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            On-call: {item.onCallOwner?.name ?? "ยังไม่ระบุ"} · Checklist {item.checklistDone}/
            {LIVE_CHECKLIST_SIZE}
          </span>
        )}
        {item.blockedReason && (
          <span className="text-xs text-destructive">ติดขัด: {item.blockedReason}</span>
        )}
      </span>
    </>
  );
  if (onSelect) {
    return (
      <button type="button" className={ENTRY} onClick={() => onSelect(item.id)}>
        {content}
      </button>
    );
  }
  return (
    <Link
      to="/staff/calendar"
      search={{ view: "day", date: dateKey(item.startAt), item: item.id }}
      className={ENTRY}
    >
      {content}
    </Link>
  );
}

function Slot({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: CalendarItem[];
  onSelect?: (itemId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-1" aria-label={title}>
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="p-1 text-sm text-muted-foreground">ไม่มี</p>
      ) : (
        items.map((item) => <Entry key={item.id} item={item} onSelect={onSelect} />)
      )}
    </section>
  );
}

/** `onSelect` opens items in place; without it, entries link to the calendar. */
export function RunSheet({ now, onSelect }: { now: number; onSelect?: (itemId: string) => void }) {
  const { calendar } = useApis();
  const anchor = Math.floor(now / ROUND_MS) * ROUND_MS;
  const range = { from: anchor - LOOK_BACK_MS, to: anchor + LOOK_AHEAD_MS };
  const items = useQuery({
    queryKey: ["calendar", "items", range],
    queryFn: () => calendar.list(range),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  return (
    <section className="flex flex-col gap-3 rounded-2xl border p-4" aria-label="Run sheet วันนี้">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Run sheet วันนี้</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          เวลาไทย {formatBangkok(now, "time")} น.
        </span>
      </header>
      {items.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="กำลังโหลด">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : items.isError && !items.data ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          โหลด run sheet ไม่สำเร็จ
          <Button variant="outline" size="sm" onClick={() => void items.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : (
        <RunSheetBody summary={summarize(items.data?.items ?? [], now)} onSelect={onSelect} />
      )}
      <MyActionItems now={now} onSelect={onSelect} />
    </section>
  );
}

function RunSheetBody({
  summary,
  onSelect,
}: {
  summary: RunSheetSummary;
  onSelect?: (itemId: string) => void;
}) {
  const one = (item: CalendarItem | null) => (item ? [item] : []);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Slot title="กำลัง Live" items={summary.liveNow} onSelect={onSelect} />
      <Slot title="Live ถัดไป" items={one(summary.nextLive)} onSelect={onSelect} />
      <Slot title="ประชุมถัดไป" items={one(summary.nextMeeting)} onSelect={onSelect} />
      <Slot title="Release ถัดไป" items={one(summary.nextRelease)} onSelect={onSelect} />
      <div className="sm:col-span-2">
        <Slot title="Blocker และความเสี่ยงสูง" items={summary.blockers} onSelect={onSelect} />
      </div>
    </div>
  );
}

/** Open action items for the viewer or the viewer's department, soonest first. */
function MyActionItems({ now, onSelect }: { now: number; onSelect?: (itemId: string) => void }) {
  const { calendar } = useApis();
  const actions = useQuery({
    queryKey: ["calendar", "my-action-items"],
    queryFn: () => calendar.myActionItems(),
    refetchInterval: 60_000,
  });
  const items = actions.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1" aria-label="Action items ของฉันและฝ่าย">
      <h3 className="text-xs font-semibold text-muted-foreground">Action items ของฉันและฝ่าย</h3>
      <ul className="flex flex-col">
        {items.map((action) => {
          const overdue = action.dueAt !== null && action.dueAt < now;
          const content = (
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{action.title}</span>
              <span className={cn("text-xs text-muted-foreground", overdue && "text-destructive")}>
                {[
                  action.dueAt &&
                    `${overdue ? "เลยกำหนด" : "ภายใน"} ${formatBangkok(action.dueAt, "dateTime")}`,
                  `จาก ${action.itemTitle}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          );
          return (
            <li key={action.id}>
              {onSelect ? (
                <button type="button" className={ENTRY} onClick={() => onSelect(action.itemId)}>
                  {content}
                </button>
              ) : (
                <Link
                  to="/staff/calendar"
                  search={{ view: "day", date: dateKey(action.itemStartAt), item: action.itemId }}
                  className={ENTRY}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
