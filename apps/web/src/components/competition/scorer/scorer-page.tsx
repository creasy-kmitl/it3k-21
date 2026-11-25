// Full-screen scorer for one match, held sideways by the court: big buttons
// per side, undo, the period or set, the optional clock, and finishing.
import type { ScoreEventPayload } from "@it3k/db/competition-rules";
import { pointsPeriodLabel } from "@it3k/db/scoring/points";
import { atInterval } from "@it3k/db/scoring/sets";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CloudOff, CloudUpload, Flag, Play, ShieldAlert, Undo2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { LoadingButton } from "@/components/loading-button";
import { useApis } from "@/lib/api-context";
import type { MatchResultBody, Scoreboard } from "@/lib/competition-scores";

import { MatchStatusBadge } from "../match-status-badge";
import { ScoreDisplay } from "../score-display";
import { MatchClock } from "./match-clock";
import { RaceControls } from "./race-controls";
import { FinishDialog, ResultDialog } from "./result-dialogs";
import { SideControls } from "./side-controls";
import { type Scorer, useScorer } from "./use-scorer";
import { useWakeLock } from "./use-wake-lock";

export function ScorerPage({ matchId }: { matchId: string }) {
  const scorer = useScorer(matchId);
  const data = scorer.board.data;
  useWakeLock(data?.match.status === "live");

  if (scorer.board.isError && !data) {
    return (
      <main className="flex min-h-dvh w-full items-center justify-center p-4">
        <ErrorState
          error={scorer.board.error}
          onRetry={() => scorer.board.refetch()}
          title="โหลดแมตช์ไม่สำเร็จ"
        />
      </main>
    );
  }
  if (!data || !scorer.state) {
    return (
      <main className="flex min-h-dvh w-full flex-col gap-4 p-4" aria-busy>
        <Skeleton className="h-10 w-2/3" />
        <div className="grid flex-1 gap-4 landscape:grid-cols-2">
          <Skeleton className="min-h-48 rounded-3xl" />
          <Skeleton className="min-h-48 rounded-3xl" />
        </div>
      </main>
    );
  }
  if (!data.canScore) {
    return (
      <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 p-4 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" aria-hidden />
        <p role="alert" className="text-lg">
          บัญชีนี้ไม่มีสิทธิ์ใส่คะแนน
        </p>
        <BackButton matchId={matchId} />
      </main>
    );
  }
  return <Scoring scorer={scorer} data={data} />;
}

function BackButton({ matchId }: { matchId: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label="กลับไปหน้าแมตช์"
      render={<Link to="/staff/matches/$matchId" params={{ matchId }} />}
      nativeButton={false}
    >
      <ArrowLeft />
    </Button>
  );
}

function Scoring({ scorer, data }: { scorer: Scorer; data: Scoreboard }) {
  const { competitionScores: api } = useApis();
  const state = scorer.state as NonNullable<Scorer["state"]>;
  const { match, scoring, sides } = data;
  const pickId = useId();
  const [pickPlayers, setPickPlayers] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<"start" | "finish" | "result" | null>(null);
  const finished = match.status === "finished" || match.status === "cancelled";
  const disabled = finished;
  const hasPlayers = sides.some((side) => side.players.length > 0);
  const send = (payload: ScoreEventPayload) => scorer.send(payload);

  const run = async (kind: "start" | "finish" | "result", call: () => Promise<Scoreboard>) => {
    setBusy(kind);
    try {
      scorer.replace(await call());
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const undo = (participantId?: string) => {
    if (!scorer.undo(participantId)) toast.info("ไม่มีรายการให้ยกเลิก");
  };
  const finish = async (force: boolean) => {
    await scorer.flush();
    const ok = await run("finish", () =>
      api.finish(match.id, { force, version: data.match.version }),
    );
    if (ok) setFinishing(false);
  };
  const saveResult = async (
    outcome: MatchResultBody["outcome"],
    ranks: MatchResultBody["ranks"],
  ) => {
    await scorer.flush();
    const ok = await run("result", () =>
      api.result(match.id, { outcome, ranks, version: data.match.version }),
    );
    if (ok) setRecording(false);
  };

  return (
    <main className="flex min-h-dvh w-full min-w-0 flex-col gap-3 bg-background p-3 sm:p-4">
      <header className="flex flex-wrap items-center gap-2">
        <BackButton matchId={match.id} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">
            {match.sport.name} · {match.division.name}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {match.stageName}
            {match.matchNo ? ` · แมตช์ ${match.matchNo}` : ""}
            {match.court ? ` · ${match.court}` : ""}
          </p>
        </div>
        <SyncBadge status={scorer.status} />
        <MatchStatusBadge status={match.status} />
      </header>

      <PeriodBar scorer={scorer} data={data} disabled={disabled} onSend={send} />

      {scoring.engine === "race" ? (
        <RaceControls
          config={scoring}
          sides={sides}
          state={state}
          events={scorer.events}
          disabled={disabled}
          onSend={send}
          onUndo={undo}
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 landscape:grid-cols-2">
          {sides.map((side) => (
            <SideControls
              key={side.id}
              scoring={scoring}
              side={side}
              participant={state.participants.find((p) => p.participantId === side.id)}
              state={state}
              disabled={disabled}
              pickPlayers={pickPlayers}
              onSend={send}
              onUndo={() => undo(side.id)}
            />
          ))}
        </div>
      )}

      {finished && (
        <section aria-label="ผลการแข่งขัน" className="rounded-3xl border bg-card p-4">
          <ScoreDisplay sides={sides} scoring={scoring} status={match.status} size="lg" />
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        {(match.status === "scheduled" || match.status === "checkin") && (
          <LoadingButton
            icon={Play}
            size="lg"
            loading={busy === "start"}
            onClick={() => void run("start", () => api.start(match.id))}
          >
            เริ่มแข่ง
          </LoadingButton>
        )}
        <Button variant="outline" size="lg" disabled={disabled} onClick={() => undo()}>
          <Undo2 data-icon="inline-start" />
          ยกเลิกรายการล่าสุด
        </Button>
        {hasPlayers && scoring.engine !== "race" && scoring.engine !== "series" && (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id={pickId}
              checked={pickPlayers}
              onCheckedChange={(checked) => setPickPlayers(checked)}
            />
            <label htmlFor={pickId}>ระบุผู้ทำแต้ม</label>
          </div>
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="ghost" size="lg" onClick={() => setRecording(true)}>
            ผลพิเศษ
          </Button>
          {!finished && (
            <Button
              size="lg"
              variant={state.decided ? "default" : "secondary"}
              onClick={() => setFinishing(true)}
            >
              <Flag data-icon="inline-start" />
              จบแมตช์
            </Button>
          )}
        </div>
      </footer>

      {state.timeline.length > 0 && (
        <section aria-label="รายการล่าสุด" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap gap-x-3 gap-y-1">
            {state.timeline
              .slice(-8)
              .reverse()
              .map((line) => (
                <li key={`${line.eventId}-${line.text}`}>
                  {sides.find((side) => side.id === line.participantId)?.name ?? ""} {line.text}
                </li>
              ))}
          </ol>
        </section>
      )}

      <FinishDialog
        open={finishing}
        onOpenChange={setFinishing}
        decided={state.decided}
        pending={scorer.status.pending}
        loading={busy === "finish"}
        onConfirm={(force) => void finish(force)}
      />
      <ResultDialog
        open={recording}
        onOpenChange={setRecording}
        sides={sides}
        loading={busy === "result"}
        onSave={(outcome, ranks) => void saveResult(outcome, ranks)}
      />
    </main>
  );
}

function SyncBadge({ status }: { status: Scorer["status"] }) {
  if (status.pending === 0) return null;
  return (
    <Badge variant={status.offline ? "destructive" : "secondary"} role="status">
      {status.offline ? <CloudOff aria-hidden /> : <CloudUpload aria-hidden />}
      {status.offline ? "ออฟไลน์ · " : "กำลังส่ง · "}
      รอส่ง {status.pending}
    </Badge>
  );
}

/** Which period, set, end or game is on, with the control that moves it on. */
function PeriodBar({
  scorer,
  data,
  disabled,
  onSend,
}: {
  scorer: Scorer;
  data: Scoreboard;
  disabled: boolean;
  onSend: (payload: ScoreEventPayload) => void;
}) {
  const state = scorer.state as NonNullable<Scorer["state"]>;
  const { scoring } = data;
  let label = "";
  let next: { text: string; period: number } | null = null;
  if (scoring.engine === "points") {
    const count = scoring.periods.count;
    label =
      state.phase === "shootout"
        ? (scoring.shootout?.label ?? "ยิงโทษ")
        : state.period > count && state.phase !== "overtime"
          ? "หมดเวลา"
          : pointsPeriodLabel(scoring, state.period);
    if (!state.decided && state.phase !== "shootout") {
      next = {
        text:
          state.period === count
            ? "หมดเวลาการแข่งขันปกติ"
            : `จบ${pointsPeriodLabel(scoring, state.period)}`,
        period: state.period + 1,
      };
    }
  } else if (scoring.engine === "sets") {
    label = `${scoring.setLabel}ที่ ${state.period}`;
  } else if (scoring.engine === "series") {
    label = `${scoring.gameLabel}ที่ ${state.period}`;
  } else if (scoring.engine === "ends") {
    label = `เอนด์ที่ ${state.period}`;
    if (!state.decided) next = { text: "เอนด์นี้ไม่มีคะแนน", period: state.period + 1 };
  } else {
    label = scoring.games > 1 ? `เกมที่ ${state.period} จาก ${scoring.games}` : "ผลการแข่งขัน";
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/50 px-3 py-2">
      <p className="text-xl font-semibold" aria-live="polite">
        {label}
      </p>
      {state.decided && <Badge>ได้ผลตามกติกาแล้ว</Badge>}
      {scoring.engine === "sets" && atInterval(state) && (
        <Badge variant="secondary" role="status">
          พักระหว่างเกม
        </Badge>
      )}
      {scoring.engine === "points" && scoring.clock && (
        <MatchClock
          config={scoring.clock}
          clock={state.clock}
          overtime={state.period > scoring.periods.count}
          disabled={disabled}
          onSend={onSend}
        />
      )}
      {next && (
        <Button
          className="ms-auto"
          variant="outline"
          size="lg"
          disabled={disabled}
          onClick={() => onSend({ type: "period", period: next.period })}
        >
          {next.text}
        </Button>
      )}
    </div>
  );
}
