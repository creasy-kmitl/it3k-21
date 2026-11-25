import { Badge } from "@it3k/ui/components/badge";
import { cn } from "@it3k/ui/lib/utils";
import { Check, Clock, MapPin } from "lucide-react";

import { formatBangkok } from "@/lib/bangkok-time";
import type { CheckinMatch, CheckinSide } from "@/lib/competition-checkins";

/** "เปิดรายงานตัว ถึง 10:30", "เปิด 10:00" or "ปิดรายงานตัวแล้ว". */
export function windowLabel(window: CheckinMatch["window"]) {
  if (!window) return "ยังไม่กำหนดเวลา";
  if (window.state === "open") {
    return `เปิดรายงานตัว ถึง ${formatBangkok(Date.parse(window.closesAt), "time")}`;
  }
  if (window.state === "early") {
    return `เปิดรายงานตัว ${formatBangkok(Date.parse(window.opensAt), "time")}`;
  }
  return "ปิดรายงานตัวแล้ว";
}

/** The match's sport, round and number, e.g. "ฟุตบอล · รอบแบ่งกลุ่ม · M3". */
export function matchTitle(match: Pick<CheckinMatch, "divisionName" | "stageName" | "matchNo">) {
  return [match.divisionName, match.stageName, match.matchNo ? `M${match.matchNo}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** "10:40 · สนามฟุตบอล · คอร์ต 1". */
export function matchWhere(match: Pick<CheckinMatch, "startAt" | "venueName" | "court">) {
  return [
    match.startAt ? formatBangkok(Date.parse(match.startAt), "time") : null,
    match.venueName,
    match.court,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A side's head count against the minimum, green once it has enough. */
export function SideCount({
  side,
  min,
  size = "sm",
}: {
  side: Pick<CheckinSide, "label" | "checkedIn" | "expected">;
  min: number;
  size?: "sm" | "lg";
}) {
  const ready = side.checkedIn >= min;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-2xl border px-3 py-2",
        ready && "border-emerald-600/40 bg-emerald-600/10",
        size === "lg" && "px-4 py-3 wide-xl:px-6 wide-xl:py-4",
      )}
    >
      <span
        className={cn(
          "min-w-0 truncate font-medium",
          size === "lg" && "text-lg md:text-xl wide-xl:text-3xl",
        )}
      >
        {side.label}
      </span>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 tabular-nums",
          size === "lg" && "text-2xl font-semibold md:text-3xl wide-xl:text-5xl",
        )}
        aria-hidden
      >
        {ready && (
          <Check
            className={cn("size-4 text-emerald-600", size === "lg" && "size-6 wide-xl:size-9")}
            aria-hidden
          />
        )}
        {side.checkedIn}
        <span
          className={cn(
            "text-sm font-normal text-muted-foreground",
            size === "lg" && "text-base md:text-lg wide-xl:text-2xl",
          )}
        >
          {" "}
          / {min}
        </span>
      </span>
      <span className="sr-only">{`${side.label} รายงานตัว ${side.checkedIn} จากขั้นต่ำ ${min} คน`}</span>
    </div>
  );
}

/** One match with each side's check-ins, for the kiosk and the staff list. */
export function MatchCheckinCard({
  match,
  size = "sm",
  className,
}: {
  match: CheckinMatch;
  size?: "sm" | "lg";
  className?: string;
}) {
  const open = match.window?.state === "open";
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-3xl border bg-card p-4",
        size === "lg" && "wide-xl:gap-4 wide-xl:p-6",
        className,
      )}
      aria-label={matchTitle(match)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            className={cn(
              "truncate font-semibold",
              size === "lg" && "text-lg md:text-xl wide-xl:text-3xl",
            )}
          >
            {matchTitle(match)}
          </h3>
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm text-muted-foreground",
              size === "lg" && "wide-xl:text-xl",
            )}
          >
            <Clock className="size-4 shrink-0" aria-hidden />
            {matchWhere(match) || "ยังไม่กำหนดเวลา"}
          </p>
        </div>
        <Badge
          variant={open ? "default" : "outline"}
          className={cn(size === "lg" && "wide-xl:text-lg")}
        >
          {windowLabel(match.window)}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {match.sides.map((side) => (
          <SideCount key={side.participantId} side={side} min={match.minPlayers} size={size} />
        ))}
      </div>
      {match.checkinMode === "manual" && size === "sm" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden />
          รายงานตัวโดยเจ้าหน้าที่ (ไม่ใช้ kiosk)
        </p>
      )}
    </article>
  );
}
