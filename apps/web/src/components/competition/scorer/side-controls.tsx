// One side's half of the scorer: its name and score, the big buttons its
// engine needs, and an undo that takes back that side's last tap.
import type {
  MatchState,
  ParticipantState,
  ScoreEventPayload,
  ScoringConfig,
} from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { Undo2 } from "lucide-react";
import { useState } from "react";

import type { ScoreboardSide } from "@/lib/competition-scores";

import { PlayerPicker } from "./player-picker";

const BIG = "h-auto min-h-20 flex-1 rounded-3xl text-3xl font-semibold tabular-nums";

export function SideControls({
  scoring,
  side,
  participant,
  state,
  disabled,
  pickPlayers,
  onSend,
  onUndo,
}: {
  scoring: ScoringConfig;
  side: ScoreboardSide;
  participant: ParticipantState | undefined;
  state: MatchState;
  disabled: boolean;
  pickPlayers: boolean;
  onSend: (payload: ScoreEventPayload) => void;
  onUndo: () => void;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const closed = disabled || state.decided;
  const score = (points: number, registrationId: string | null = null) =>
    onSend({ type: "score", participantId: side.id, points, registrationId });
  const tapScore = (points: number) => {
    if (pickPlayers && side.players.length) setPicking(points);
    else score(points);
  };
  const detail = participant?.detail;

  return (
    <section
      aria-label={side.name}
      className="flex min-h-0 flex-col gap-3 rounded-3xl border bg-card p-3 sm:p-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold sm:text-xl">{side.name}</h2>
          {detail?.parts && detail.parts.length > 1 && (
            <p className="truncate text-sm text-muted-foreground tabular-nums">
              {detail.parts.join(" · ")}
            </p>
          )}
          {detail?.shootout && (
            <p className="text-sm text-muted-foreground">
              ยิงโทษ {detail.shootout.scored}/{detail.shootout.taken}
            </p>
          )}
        </div>
        <output
          className="text-6xl leading-none font-bold tabular-nums sm:text-7xl"
          aria-label={`คะแนน ${side.name}`}
        >
          {participant?.score ?? 0}
        </output>
      </header>

      {scoring.engine === "sets" && (
        <output
          className="block text-center text-4xl font-semibold tabular-nums"
          aria-label="แต้มในเกมนี้"
        >
          {detail?.parts?.at(-1) ?? 0}
        </output>
      )}

      <div className="flex flex-1 flex-wrap items-stretch gap-2">
        {scoring.engine === "points" &&
          state.phase !== "shootout" &&
          scoring.buttons.map((points) => (
            <Button key={points} className={BIG} disabled={closed} onClick={() => tapScore(points)}>
              +{points}
            </Button>
          ))}
        {scoring.engine === "points" && state.phase === "shootout" && (
          <>
            <Button
              className={BIG}
              disabled={closed}
              onClick={() => onSend({ type: "shootout", participantId: side.id, scored: true })}
            >
              เข้า
            </Button>
            <Button
              className={BIG}
              variant="secondary"
              disabled={closed}
              onClick={() => onSend({ type: "shootout", participantId: side.id, scored: false })}
            >
              ไม่เข้า
            </Button>
          </>
        )}
        {scoring.engine === "sets" && (
          <Button className={BIG} disabled={closed} onClick={() => tapScore(1)}>
            +1
          </Button>
        )}
        {scoring.engine === "series" && !scoring.fromSubMatches && (
          <Button
            className={cn(BIG, "text-xl")}
            disabled={closed}
            onClick={() => onSend({ type: "game", participantId: side.id })}
          >
            ชนะ{scoring.gameLabel}นี้
          </Button>
        )}
        {scoring.engine === "ends" && (
          <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-6">
            {Array.from({ length: scoring.maxPerEnd }, (_, i) => i + 1).map((points) => (
              <Button
                key={points}
                className="h-16 rounded-2xl text-2xl font-semibold"
                disabled={closed}
                aria-label={`เอนด์นี้ได้ ${points} แต้ม`}
                onClick={() => tapScore(points)}
              >
                +{points}
              </Button>
            ))}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="lg"
          disabled={disabled}
          onClick={onUndo}
          aria-label={`ยกเลิกรายการล่าสุดของ ${side.name}`}
        >
          <Undo2 data-icon="inline-start" />
          ยกเลิก
        </Button>
        {scoring.engine === "points" && (
          <>
            <Button
              variant="ghost"
              size="lg"
              disabled={closed}
              onClick={() =>
                onSend({ type: "stat", participantId: side.id, stat: "foul", registrationId: null })
              }
            >
              ฟาวล์{detail?.stats?.foul ? ` (${detail.stats.foul})` : ""}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              disabled={closed}
              onClick={() =>
                onSend({
                  type: "stat",
                  participantId: side.id,
                  stat: "timeout",
                  registrationId: null,
                })
              }
            >
              เวลานอก{detail?.stats?.timeout ? ` (${detail.stats.timeout})` : ""}
            </Button>
          </>
        )}
      </footer>

      <PlayerPicker
        open={picking !== null}
        title={`${side.name} +${picking ?? ""}`}
        players={side.players}
        onClose={() => setPicking(null)}
        onPick={(registrationId) => {
          if (picking !== null) score(picking, registrationId);
          setPicking(null);
        }}
      />
    </section>
  );
}
