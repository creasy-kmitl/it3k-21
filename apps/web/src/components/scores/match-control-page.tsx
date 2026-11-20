import { type MatchStatus, currentStatus } from "@it3k/db/match-rules";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Flag,
  Minus,
  OctagonPause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SideDrawer } from "@/components/calendar/side-drawer";
import { MatchForm } from "@/components/scores/match-form";
import { MatchTimeline, breakAt, timelineSegments } from "@/components/scores/match-timeline";
import { MATCHES_QUERY_KEY } from "@/components/scores/scores-page";
import { TeamChip } from "@/components/scores/team-chip";
import { type Segment, SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { type Match, type MatchUpdate, STATUS_LABELS, isStale, universityLabel } from "@/lib/matches";

/** How much one press of + or − moves a score. */
const STEPS: Segment<number>[] = [
  { value: 1, label: "+1" },
  { value: 2, label: "+2" },
  { value: 3, label: "+3" },
];

const MINUTE_MS = 60 * 1000;
/** How often the page checks for scores other staff saved. */
const REFRESH_MS = 15_000;

/** Re-renders every so often, so the timeline's "now" keeps moving while the page is open. */
function useNow(everyMs = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function ScoreControl({
  match,
  side,
  step,
  canScore,
  busy,
  onChange,
}: {
  match: Match;
  side: "A" | "B";
  step: number;
  /** Scores move only while play is on: not before kick-off, in a break, or in a stop. */
  canScore: boolean;
  busy: boolean;
  onChange: (next: number) => void;
}) {
  const score = (side === "A" ? match.scoreA : match.scoreB) ?? 0;
  const name = universityLabel(side === "A" ? match.teamA : match.teamB);
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4">
      <Button
        size="icon-lg"
        variant="outline"
        className="size-11 rounded-full sm:size-14"
        aria-label={`ลดคะแนน ${name}`}
        disabled={!canScore || busy || score === 0}
        onClick={() => onChange(Math.max(0, score - step))}
      >
        <Minus className="size-5 sm:size-6" />
      </Button>
      <output
        aria-label={`คะแนน ${name}`}
        className="min-w-[1.5ch] text-center text-7xl font-bold leading-none tracking-tight tabular-nums sm:text-9xl"
      >
        {score}
      </output>
      <Button
        size="icon-lg"
        className="size-11 rounded-full sm:size-14"
        aria-label={`เพิ่มคะแนน ${name}`}
        disabled={!canScore || busy}
        onClick={() => onChange(score + step)}
      >
        <Plus className="size-5 sm:size-6" />
      </Button>
    </div>
  );
}

/** Minutes of emergency stops so far, the one running now included. */
function stoppedMinutes(match: Match, now: number) {
  const running = match.pausedAt ? Math.max(0, now - match.pausedAt) : 0;
  return (match.pausedMs + running) / MINUTE_MS;
}

/**
 * How far into the planned schedule the match is, for the timeline's shading.
 * Stops do not count: while stopped, the shading holds still.
 */
function elapsedFor(match: Match, status: MatchStatus, now: number) {
  if (!match.startsAt || match.durationMinutes == null || status === "scheduled") return undefined;
  if (status === "finished") {
    return timelineSegments(match.durationMinutes, match.breaks).reduce(
      (sum, segment) => sum + segment.minutes,
      0,
    );
  }
  return (now - match.startsAt) / MINUTE_MS - stoppedMinutes(match, now);
}

/**
 * One match, run from the sideline: big scores with + and −, how much each
 * press adds, the button that starts or ends the match, and its timeline.
 */
export function MatchControlPage({ matchId }: { matchId: string }) {
  const { matches } = useApis();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();
  const [step, setStep] = useState(1);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const list = useQuery({
    queryKey: MATCHES_QUERY_KEY,
    queryFn: () => matches.list(),
    refetchInterval: REFRESH_MS,
  });
  const match = list.data?.items.find((item) => item.id === matchId);

  const refresh = () => queryClient.invalidateQueries({ queryKey: MATCHES_QUERY_KEY });
  const failed = (what: string) => (error: Error) => {
    if (isStale(error)) {
      toast.error("มีคนแก้แมตช์นี้ก่อน โหลดข้อมูลล่าสุดแล้ว ลองอีกครั้ง");
      void refresh();
      return;
    }
    toast.error(`${what}ไม่สำเร็จ: ${error.message}`);
  };

  const update = useMutation({
    mutationFn: (input: MatchUpdate) => matches.update(matchId, input),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
    onError: failed("บันทึก"),
  });

  const remove = useMutation({
    mutationFn: (target: Match) => matches.remove(target.id, target.version),
    onSuccess: async () => {
      toast.success("ลบแมตช์แล้ว");
      await refresh();
      await navigate({ to: "/staff/scores" });
    },
    onError: failed("ลบแมตช์"),
  });

  const back = (
    <Link
      to="/staff/scores"
      className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4" />
      กลับไปรายการแมตช์
    </Link>
  );

  if (list.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {back}
        <Skeleton className="h-[28rem] rounded-3xl" />
      </div>
    );
  }
  if (list.isError) {
    return <p className="text-destructive">โหลดแมตช์ไม่สำเร็จ: {list.error.message}</p>;
  }
  if (!match) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {back}
        <p className="text-muted-foreground">ไม่พบแมตช์นี้ อาจถูกลบไปแล้ว</p>
      </div>
    );
  }

  // Goes live by itself at its start time, even before the next reload.
  const status = currentStatus(match.status, match.startsAt, now);
  const live = status === "live";
  const stopped = live && match.pausedAt !== null;
  const elapsed = elapsedFor(match, status, now);
  const onBreak = live && !stopped && elapsed !== undefined ? breakAt(match.breaks, elapsed) : null;
  // No play, no points: not before kick-off, not in a planned break, not in an emergency stop.
  const canScore = live && !stopped && !onBreak;
  const delay = stoppedMinutes(match, now);
  const save = (input: Omit<MatchUpdate, "version">) =>
    update.mutate({ ...input, version: match.version });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      {back}

      <section
        aria-label={`คุมแมตช์ ${match.sport}`}
        className="flex flex-col gap-8 rounded-3xl border bg-card p-5 shadow-sm sm:p-10"
      >
        {/* Teams in the corners, the match and its state between them. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
          <div className="flex flex-col items-center gap-1.5">
            <TeamChip team={match.teamA} size="lg" />
            <span className="text-sm font-medium">{universityLabel(match.teamA)}</span>
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="m-0 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              กีฬา
            </p>
            <h1 className="m-0 text-2xl font-bold tracking-tight sm:text-3xl">{match.sport}</h1>
            <p className="m-0 text-sm text-muted-foreground">
              {[match.round, match.startsAt && formatBangkok(match.startsAt, "dateTime")]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <span
              className={cn(
                "mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
                stopped
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : live
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {live && !stopped && <span className="size-2 animate-pulse rounded-full bg-current" />}
              {stopped ? "หยุดชั่วคราว" : STATUS_LABELS[status]}
            </span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <TeamChip team={match.teamB} size="lg" />
            <span className="text-sm font-medium">{universityLabel(match.teamB)}</span>
          </div>
        </div>

        {stopped && match.pausedAt && (
          <div
            role="status"
            className="flex flex-col items-center gap-1 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-center"
          >
            <p className="m-0 text-3xl font-bold tracking-widest text-destructive uppercase sm:text-4xl">
              Stop
            </p>
            <p className="m-0 text-sm text-muted-foreground">
              หยุดการแข่งขันชั่วคราวตั้งแต่ {formatBangkok(match.pausedAt, "time")} · เวลาจบเลื่อนออกไปตามเวลาที่หยุด
            </p>
          </div>
        )}

        {onBreak && (
          <div
            role="status"
            className="flex flex-col items-center gap-1 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center"
          >
            <p className="m-0 text-2xl font-bold text-amber-700 sm:text-3xl dark:text-amber-400">
              พักครั้งที่ {onBreak.number}
            </p>
            <p className="m-0 text-sm text-muted-foreground">
              {match.startsAt
                ? `แข่งต่อเวลา ${formatBangkok(match.startsAt + (onBreak.to + delay) * MINUTE_MS, "time")}`
                : "ระหว่างพักบวกคะแนนไม่ได้"}
            </p>
          </div>
        )}

        {/* The scores, as large as the screen allows. */}
        <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[1fr_auto_1fr]">
          <ScoreControl
            match={match}
            side="A"
            step={step}
            canScore={canScore}
            busy={update.isPending}
            onChange={(scoreA) => save({ scoreA })}
          />
          <span aria-hidden className="hidden text-6xl font-light text-muted-foreground sm:block">
            :
          </span>
          <ScoreControl
            match={match}
            side="B"
            step={step}
            canScore={canScore}
            busy={update.isPending}
            onChange={(scoreB) => save({ scoreB })}
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">บวกทีละ</span>
            <SegmentedControl label="บวกทีละ" segments={STEPS} value={step} onChange={setStep} />
          </div>
          {status === "scheduled" && (
            <p className="m-0 text-sm text-muted-foreground">
              {match.startsAt
                ? `แมตช์เริ่มเองเวลา ${formatBangkok(match.startsAt, "dateTime")} แล้วจึงบวกคะแนนได้`
                : "ยังไม่กำหนดเวลาแข่ง กด “แก้ไขรายละเอียด” เพื่อเพิ่ม"}
            </p>
          )}
          {live && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {stopped ? (
                <Button size="lg" disabled={update.isPending} onClick={() => save({ paused: false })}>
                  <Play data-icon="inline-start" />
                  แข่งต่อ
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={update.isPending}
                  onClick={() => save({ paused: true })}
                >
                  <OctagonPause data-icon="inline-start" />
                  หยุดฉุกเฉิน
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                disabled={update.isPending}
                onClick={() => save({ status: "finished" })}
              >
                <Flag data-icon="inline-start" />
                จบแมตช์
              </Button>
            </div>
          )}
          {status === "finished" && (
            <>
              <p className="m-0 text-sm text-muted-foreground">
                แมตช์จบแล้ว กด “กลับมาแข่งต่อ” ถ้าต้องแก้คะแนน
              </p>
              <Button
                variant="outline"
                disabled={update.isPending}
                onClick={() => save({ status: "live" })}
              >
                <RotateCcw data-icon="inline-start" />
                กลับมาแข่งต่อ
              </Button>
            </>
          )}
        </div>

        {match.durationMinutes != null ? (
          <MatchTimeline
            size="lg"
            durationMinutes={match.durationMinutes}
            breaks={match.breaks}
            startsAt={match.startsAt}
            elapsedMinutes={elapsed}
            delayMinutes={delay}
          />
        ) : (
          <p className="m-0 text-center text-sm text-muted-foreground">
            แมตช์นี้ยังไม่มีเวลาแข่ง กด “แก้ไขรายละเอียด” เพื่อเพิ่ม
          </p>
        )}
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {match.updatedBy &&
            `แก้ล่าสุดโดย ${match.updatedBy.name} · ${formatBangkok(match.updatedAt, "dateTime")}`}
        </span>
        <Button variant="outline" onClick={() => setEditing(true)}>
          <Pencil data-icon="inline-start" />
          แก้ไขรายละเอียด
        </Button>
      </div>

      <SideDrawer
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
          if (!open) setConfirmDelete(false);
        }}
        title="แก้ไขแมตช์"
      >
        {editing && (
          <div className="flex flex-col gap-6">
            <MatchForm
              key={`${match.id}-${match.version}`}
              initial={match}
              sports={[...new Set(list.data.items.map((item) => item.sport))]}
              pending={update.isPending}
              onCancel={() => setEditing(false)}
              onSubmit={(input) => save(input)}
            />
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => (confirmDelete ? remove.mutate(match) : setConfirmDelete(true))}
            >
              <Trash2 data-icon="inline-start" />
              {confirmDelete ? "กดอีกครั้งเพื่อยืนยันการลบ" : "ลบแมตช์"}
            </Button>
          </div>
        )}
      </SideDrawer>
    </div>
  );
}
