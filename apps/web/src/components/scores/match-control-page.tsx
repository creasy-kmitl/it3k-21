import {
  MATCH_STATUSES,
  type MatchSet,
  type MatchStatus,
  RANKING_MAX,
  UNIVERSITIES,
  type University,
  setsWon,
} from "@it3k/db/match-rules";
import { Button } from "@it3k/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
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
import { SetsBoard } from "@/components/scores/sets-board";
import { TeamChip } from "@/components/scores/team-chip";
import { type Segment, SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import {
  type Match,
  type MatchUpdate,
  SETS_TO_WIN_LABELS,
  isStale,
  sidesOf,
  STATUS_LABELS,
  universityLabel,
} from "@/lib/matches";

/** How much one press of + or − moves a score. */
const STEPS: Segment<number>[] = [
  { value: 1, label: "+1" },
  { value: 2, label: "+2" },
  { value: 3, label: "+3" },
];

/** The status of a match with many teams is set by hand, since nothing starts it by itself. */
const STATUS_SEGMENTS: Segment<MatchStatus>[] = MATCH_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

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
  team,
  score: saved,
  step,
  canScore,
  busy,
  onChange,
}: {
  team: University;
  score: number | null;
  step: number;
  /** Scores move only while play is on: not before kick-off, in a break, or in a stop. */
  canScore: boolean;
  busy: boolean;
  onChange: (next: number) => void;
}) {
  const score = saved ?? 0;
  const name = universityLabel(team);
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

const NO_PLACE = "__none";
const PLACE_ITEMS = [
  { value: NO_PLACE, label: "ยังไม่ระบุ" },
  ...UNIVERSITIES.map((value) => ({ value, label: universityLabel(value) })),
];

/**
 * Who placed 1st, 2nd and 3rd, for a match announced after it ends. A place
 * needs the one above it; a university may hold several places.
 */
function RankingControl({
  saved,
  busy,
  onSave,
}: {
  saved: University[];
  busy: boolean;
  onSave: (ranking: University[]) => void;
}) {
  const [places, setPlaces] = useState<(University | null)[]>(() =>
    Array.from({ length: RANKING_MAX }, (_, index) => saved[index] ?? null),
  );
  const ranking = places.filter((team): team is University => team !== null);
  const gap = places.some((team, index) => team === null && places[index + 1] != null);
  const problem = gap ? "ต้องใส่อันดับที่สูงกว่าก่อน" : null;
  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!problem) onSave(ranking);
      }}
    >
      <p className="m-0 text-center font-medium">ผลการแข่งขัน</p>
      {places.map((team, index) => (
        <div key={index} className="flex items-center gap-3">
          <span className="w-8 text-center text-2xl font-bold tabular-nums">{index + 1}</span>
          <Select
            items={PLACE_ITEMS}
            value={team ?? NO_PLACE}
            onValueChange={(next: string | null) =>
              next &&
              setPlaces((current) =>
                current.map((other, at) =>
                  at === index ? (next === NO_PLACE ? null : (next as University)) : other,
                ),
              )
            }
          >
            <SelectTrigger aria-label={`อันดับ ${index + 1}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLACE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {problem && <p className="m-0 text-center text-sm text-destructive">{problem}</p>}
      <Button type="submit" disabled={busy || problem !== null}>
        บันทึกผล
      </Button>
    </form>
  );
}

type Sides = { a: University; b: University };

const STATUS_CONTROL_LABEL = "สถานะแมตช์";

/**
 * A series of sets: the board, the running set's points with + and −, the
 * button that ends the set, and a way back if a set was ended by mistake.
 * Ending the set that decides the series finishes the match.
 */
function SetsControl({
  match,
  sides,
  status,
  step,
  busy,
  save,
}: {
  match: Match;
  sides: Sides;
  status: MatchStatus;
  step: number;
  busy: boolean;
  save: (input: Omit<MatchUpdate, "version">) => void;
}) {
  const sets = match.sets;
  const toWin = match.setsToWin ?? 2;
  const last = sets.at(-1);
  const running = last && !last.done ? last : null;
  const wins = setsWon(sets);
  const decided = wins.a === toWin || wins.b === toWin;
  const canScore = status === "live" && running !== null && !decided;
  const withRunning = (change: Partial<MatchSet>): MatchSet[] =>
    running ? [...sets.slice(0, -1), { ...running, ...change }] : sets;

  function endSet() {
    const finished = withRunning({ done: true });
    const result = setsWon(finished);
    const over = result.a === toWin || result.b === toWin;
    save({ sets: over ? finished : [...finished, { a: 0, b: 0, done: false }] });
  }

  function undoSet() {
    const kept = running ? sets.slice(0, -1) : sets;
    const previous = kept.at(-1);
    if (!previous) return;
    save({
      sets: [...kept.slice(0, -1), { ...previous, done: false }],
      ...(status === "finished" ? { status: "live" as const } : {}),
    });
  }

  return (
    <>
      <SetsBoard a={sides.a} b={sides.b} sets={sets} setsToWin={match.setsToWin} />
      {running && !decided && (
        <p className="m-0 text-center text-sm font-medium text-muted-foreground">
          เซตที่ {sets.length}
        </p>
      )}
      <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[1fr_auto_1fr]">
        <ScoreControl
          team={sides.a}
          score={running?.a ?? null}
          step={step}
          canScore={canScore}
          busy={busy}
          onChange={(a) => save({ sets: withRunning({ a }) })}
        />
        <span aria-hidden className="hidden text-6xl font-light text-muted-foreground sm:block">
          :
        </span>
        <ScoreControl
          team={sides.b}
          score={running?.b ?? null}
          step={step}
          canScore={canScore}
          busy={busy}
          onChange={(b) => save({ sets: withRunning({ b }) })}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="lg"
          disabled={busy || !canScore || running.a === running.b}
          onClick={endSet}
        >
          <Flag data-icon="inline-start" />
          จบเซตที่ {sets.length}
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={busy || !sets.some((set) => set.done)}
          onClick={undoSet}
        >
          <RotateCcw data-icon="inline-start" />
          ย้อนเซตล่าสุด
        </Button>
      </div>
      <p className="m-0 text-center text-sm text-muted-foreground">
        {SETS_TO_WIN_LABELS[toWin]} · ใครชนะครบ {toWin} เซตก่อนเป็นฝ่ายชนะ และแมตช์จะจบเอง
      </p>
    </>
  );
}

/** A pair match reported after it ends: staff finish it, then say who won. */
function WinnerControl({
  match,
  sides,
  status,
  busy,
  onWinner,
}: {
  match: Match;
  sides: Sides;
  status: MatchStatus;
  busy: boolean;
  onWinner: (winner: University) => void;
}) {
  if (status !== "finished") {
    return (
      <p className="m-0 text-center text-sm text-muted-foreground">
        ผู้ชมเห็นแค่กำหนดการ เลือก “สิ้นสุดการแข่งขัน” เมื่อแข่งเสร็จ แล้วเลือกผู้ชนะ
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
      <p className="m-0 text-center font-medium">ผู้ชนะ</p>
      {[sides.a, sides.b].map((team) => (
        <Button
          key={team}
          size="lg"
          variant={match.winner === team ? "default" : "outline"}
          disabled={busy}
          onClick={() => onWinner(team)}
        >
          {universityLabel(team)} ชนะ
        </Button>
      ))}
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
  const status = match.status;
  const live = status === "live";
  const stopped = live && match.pausedAt !== null;
  const elapsed = elapsedFor(match, status, now);
  const onBreak = live && !stopped && elapsed !== undefined ? breakAt(match.breaks, elapsed) : null;
  // No play, no points: not before kick-off, not in a planned break, not in an emergency stop.
  const canScore = live && !stopped && !onBreak;
  const delay = stoppedMinutes(match, now);
  const sides = sidesOf(match);
  // Which screen the match gets: a running score, a series of sets, a winner, or a ranking.
  const mode = sides ? match.scoring : "multi";
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
          {sides && mode !== "sets" ? (
            <div className="flex flex-col items-center gap-1.5">
              <TeamChip team={sides.a} size="lg" />
              <span className="text-sm font-medium">{universityLabel(sides.a)}</span>
            </div>
          ) : (
            <span />
          )}
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="m-0 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              กีฬา
            </p>
            <h1 className="m-0 text-2xl font-bold tracking-tight sm:text-3xl">{match.sport}</h1>
            <p className="m-0 text-sm text-muted-foreground">
              {[match.division, match.round, match.startsAt && formatBangkok(match.startsAt, "dateTime")]
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
          {sides && mode !== "sets" ? (
            <div className="flex flex-col items-center gap-1.5">
              <TeamChip team={sides.b} size="lg" />
              <span className="text-sm font-medium">{universityLabel(sides.b)}</span>
            </div>
          ) : (
            <span />
          )}
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

        {mode === "points" && sides && (
          <>
        {/* The scores, as large as the screen allows. */}
        <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[1fr_auto_1fr]">
          <ScoreControl
            team={sides.a}
            score={match.scoreA}
            step={step}
            canScore={canScore}
            busy={update.isPending}
            onChange={(scoreA) => save({ scoreA })}
          />
          <span aria-hidden className="hidden text-6xl font-light text-muted-foreground sm:block">
            :
          </span>
          <ScoreControl
            team={sides.b}
            score={match.scoreB}
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
            <>
              <p className="m-0 text-sm text-muted-foreground">
                {match.startsAt
                  ? `กำหนดแข่งเวลา ${formatBangkok(match.startsAt, "dateTime")} กด “เริ่มแมตช์” เมื่อเริ่มแข่งจริง แล้วจึงบวกคะแนนได้`
                  : "ยังไม่กำหนดเวลาแข่ง กด “แก้ไขรายละเอียด” เพื่อเพิ่ม"}
              </p>
              <Button size="lg" disabled={update.isPending} onClick={() => save({ status: "live" })}>
                <Play data-icon="inline-start" />
                เริ่มแมตช์
              </Button>
            </>
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

          </>
        )}

        {mode === "sets" && sides && (
          <>
            <SetsControl
              match={match}
              sides={sides}
              status={status}
              step={step}
              busy={update.isPending}
              save={save}
            />
            <div className="flex flex-col items-center gap-3">
              <SegmentedControl
                label={STATUS_CONTROL_LABEL}
                segments={STATUS_SEGMENTS}
                value={status}
                onChange={(next) => next !== status && save({ status: next })}
              />
            </div>
          </>
        )}

        {mode === "after" && sides && (
          <div className="flex flex-col items-center gap-4">
            <SegmentedControl
              label={STATUS_CONTROL_LABEL}
              segments={STATUS_SEGMENTS}
              value={status}
              onChange={(next) => next !== status && save({ status: next })}
            />
            <WinnerControl
              match={match}
              sides={sides}
              status={status}
              busy={update.isPending}
              onWinner={(winner) =>
                // Naming the winner is the last thing a match needs, so it goes back to the list.
                update.mutate(
                  { winner, version: match.version },
                  { onSuccess: () => navigate({ to: "/staff/scores" }) },
                )
              }
            />
          </div>
        )}

        {mode === "multi" && (
          <>
        {/* Many teams: no live score, so staff set the status by hand and record the places. */}
        <div className="flex flex-col items-center gap-4">
          <SegmentedControl
            label="สถานะแมตช์"
            segments={STATUS_SEGMENTS}
            value={status}
            onChange={(next) => next !== status && save({ status: next })}
          />
          {status === "finished" ? (
            <RankingControl
              key={match.version}
              saved={match.ranking}
              busy={update.isPending}
              onSave={(ranking) =>
                // The places are the last thing a match needs, so saving them goes back to the list.
                update.mutate(
                  { ranking, version: match.version },
                  { onSuccess: () => navigate({ to: "/staff/scores" }) },
                )
              }
            />
          ) : (
            <p className="m-0 text-sm text-muted-foreground">
              ผู้ชมเห็นแค่กำหนดการ เลือก “สิ้นสุดการแข่งขัน” เมื่อแข่งเสร็จ แล้วใส่อันดับ 1–3
            </p>
          )}
        </div>

          </>
        )}

        {match.durationMinutes != null ? (
          <MatchTimeline
            size="lg"
            durationMinutes={match.durationMinutes}
            breaks={match.breaks}
            startsAt={match.startsAt}
            elapsedMinutes={elapsed}
            delayMinutes={delay}
          />
        ) : mode === "points" ? (
          <p className="m-0 text-center text-sm text-muted-foreground">
            แมตช์นี้ยังไม่มีเวลาแข่ง กด “แก้ไขรายละเอียด” เพื่อเพิ่ม
          </p>
        ) : null}
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
