import type { MatchBreak } from "@it3k/db/match-rules";
import { cn } from "@it3k/ui/lib/utils";

import { formatBangkok } from "@/lib/bangkok-time";

const MINUTE_MS = 60 * 1000;

type Segment = { kind: "play" | "break"; minutes: number; startsAtPlay: number };

/** Splits a match into stretches of play with the breaks between them, in order. */
export function timelineSegments(durationMinutes: number, breaks: MatchBreak[]): Segment[] {
  const segments: Segment[] = [];
  let played = 0;
  for (const pause of breaks) {
    if (pause.atMinute > played) {
      segments.push({ kind: "play", minutes: pause.atMinute - played, startsAtPlay: played });
    }
    segments.push({ kind: "break", minutes: pause.minutes, startsAtPlay: pause.atMinute });
    played = pause.atMinute;
  }
  if (durationMinutes > played) {
    segments.push({ kind: "play", minutes: durationMinutes - played, startsAtPlay: played });
  }
  return segments;
}

/**
 * Where each break sits on the schedule, counted in minutes from kick-off with
 * the breaks before it included: a break at minute 45 of play after a 10-minute
 * break runs from minute 55 to 55 + its length.
 */
export function breakWindows(breaks: MatchBreak[]) {
  let breaksBefore = 0;
  return breaks.map((pause) => {
    const from = pause.atMinute + breaksBefore;
    breaksBefore += pause.minutes;
    return { ...pause, from, to: from + pause.minutes };
  });
}

/** The break under way at this point of the schedule, with its number from 1, if any. */
export function breakAt(breaks: MatchBreak[], elapsedMinutes: number) {
  const windows = breakWindows(breaks);
  const index = windows.findIndex(
    (pause) => elapsedMinutes >= pause.from && elapsedMinutes < pause.to,
  );
  const current = windows[index];
  return current ? { ...current, number: index + 1 } : null;
}

/**
 * The match drawn as one bar: stretches of play in the primary colour, breaks
 * striped, each as wide as its share of the whole time on the clock.
 */
export function MatchTimeline({
  durationMinutes,
  breaks,
  startsAt,
  elapsedMinutes,
  delayMinutes = 0,
  size = "sm",
}: {
  durationMinutes: number;
  /** Already checked: inside the match and sorted by minute. */
  breaks: MatchBreak[];
  /** Kick-off, when known, so both ends show a clock time instead of a minute. */
  startsAt?: number | null;
  /** Minutes of the planned schedule already used, breaks included; shades what has passed. */
  elapsedMinutes?: number;
  /** Minutes lost to emergency stops: everything still ahead happens this much later. */
  delayMinutes?: number;
  size?: "sm" | "lg";
}) {
  const segments = timelineSegments(durationMinutes, breaks);
  const total = segments.reduce((sum, segment) => sum + segment.minutes, 0);
  const breakTotal = total - durationMinutes;
  const passed =
    elapsedMinutes === undefined ? null : Math.min(Math.max(elapsedMinutes, 0), total);
  // What is still ahead moves back by the stops; what already happened stays put.
  const clock = (minutesIn: number) => {
    if (!startsAt) return null;
    const late = passed !== null && minutesIn > passed ? delayMinutes : 0;
    return formatBangkok(startsAt + (minutesIn + late) * MINUTE_MS, "time");
  };
  const startLabel = startsAt ? `เริ่ม ${clock(0)}` : "นาทีที่ 0";
  const endLabel = startsAt ? `จบ ${clock(total)}` : `นาทีที่ ${total}`;

  const breakTimes = breakWindows(breaks);

  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={`แข่ง ${durationMinutes} นาที พัก ${breaks.length} ครั้ง รวม ${total} นาที`}
        className={cn(
          "relative flex w-full overflow-hidden rounded-lg border",
          size === "lg" ? "h-12 rounded-xl" : "h-8",
        )}
      >
        {passed !== null && passed > 0 && (
          <div
            aria-hidden
            style={{ width: `${(passed / total) * 100}%` }}
            className="pointer-events-none absolute inset-y-0 left-0 z-10 border-r-2 border-primary bg-background/60"
          />
        )}
        {segments.map((segment) => (
          <div
            key={`${segment.kind}-${segment.startsAtPlay}`}
            style={{ flexGrow: segment.minutes }}
            className={cn(
              "flex min-w-0 basis-0 items-center justify-center font-medium tabular-nums",
              size === "lg" ? "text-xs" : "text-[10px]",
              segment.kind === "play"
                ? "bg-primary/15 text-primary"
                : "bg-[repeating-linear-gradient(45deg,var(--color-muted),var(--color-muted)_4px,transparent_4px,transparent_8px)] text-muted-foreground",
            )}
          >
            <span className="truncate px-1">
              {segment.kind === "play" ? segment.minutes : `พัก ${segment.minutes}`}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{startLabel}</span>
        <span className="text-center">
          แข่ง {durationMinutes} + พัก {breakTotal} = {total} นาที
          {delayMinutes >= 1 && ` · หยุดไป ${Math.round(delayMinutes)} นาที`}
        </span>
        <span className="font-medium text-foreground">{endLabel}</span>
      </figcaption>
      {startsAt && breakTimes.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-xs text-muted-foreground tabular-nums">
          {breakTimes.map((pause, index) => (
            <li key={pause.atMinute} className="rounded-full bg-muted px-2.5 py-1">
              พักครั้งที่ {index + 1} · {clock(pause.from)}–{clock(pause.to)}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
