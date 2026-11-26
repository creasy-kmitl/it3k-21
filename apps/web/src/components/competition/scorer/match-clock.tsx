import type { ClockConfig, ClockState, ScoreEventPayload } from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

/** Seconds left on a countdown clock at `now`. */
export function clockSeconds(clock: ClockState, now: number) {
  if (!clock.running || clock.startedAt === null) return clock.seconds;
  return Math.max(0, clock.seconds - Math.floor((now - clock.startedAt) / 1000));
}

export const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The optional game clock: start, pause and reset are score events too. */
export function MatchClock({
  config,
  clock,
  overtime,
  disabled,
  onSend,
}: {
  config: ClockConfig;
  clock: ClockState | null;
  overtime: boolean;
  disabled?: boolean;
  onSend: (payload: ScoreEventPayload) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = clock?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);
  const full = overtime ? (config.overtimeSeconds ?? config.periodSeconds) : config.periodSeconds;
  const seconds = clock ? clockSeconds(clock, now) : full;
  const send = (action: "start" | "pause" | "reset", at: number) =>
    onSend({ type: "clock", action, seconds: at });

  return (
    <div className="flex items-center gap-2">
      <span
        className="min-w-20 text-center font-mono text-3xl font-semibold tabular-nums"
        role="timer"
        aria-label="เวลาที่เหลือ"
      >
        {formatClock(seconds)}
      </span>
      {running ? (
        <Button
          size="icon-lg"
          variant="secondary"
          aria-label="หยุดเวลา"
          disabled={disabled}
          onClick={() => send("pause", clockSeconds(clock as ClockState, Date.now()))}
        >
          <Pause />
        </Button>
      ) : (
        <Button
          size="icon-lg"
          aria-label="เดินเวลา"
          disabled={disabled || seconds === 0}
          onClick={() => send("start", seconds)}
        >
          <Play />
        </Button>
      )}
      <Button
        size="icon-lg"
        variant="ghost"
        aria-label="ตั้งเวลาใหม่"
        disabled={disabled || running}
        onClick={() => send("reset", full)}
      >
        <RotateCcw />
      </Button>
    </div>
  );
}
