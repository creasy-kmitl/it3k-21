// Races and placings: one row per side. Times and distances are typed in;
// placings are picked per athlete for the game being played.
import type {
  MatchState,
  RaceConfig,
  ScoreEventPayload,
  ScoreEventRecord,
} from "@it3k/db/competition-rules";
import { RACE_STATUS_LABELS, formatRaceValue } from "@it3k/db/scoring/race";
import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
import { Undo2 } from "lucide-react";
import { useId, useState } from "react";

import type { ScoreboardSide } from "@/lib/competition-scores";

/** "10.98" or "1:02.35" as ms; "6.45" metres as mm. Null when it does not read. */
export function parseRaceInput(measure: "time" | "distance", text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (measure === "distance") {
    if (!/^\d+(\.\d{1,3})?$/.test(value)) return null;
    return Math.round(Number(value) * 1000);
  }
  const match = /^(?:(\d+):)?(\d{1,2}|\d+)(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const [, minutes, seconds, fraction = ""] = match;
  if (minutes !== undefined && Number(seconds) >= 60) return null;
  const ms = Number(fraction.padEnd(3, "0"));
  return (Number(minutes ?? 0) * 60 + Number(seconds)) * 1000 + ms;
}

export function RaceControls({
  config,
  sides,
  state,
  events,
  disabled,
  onSend,
  onUndo,
}: {
  config: RaceConfig;
  sides: ScoreboardSide[];
  state: MatchState;
  events: readonly ScoreEventRecord[];
  disabled: boolean;
  onSend: (payload: ScoreEventPayload) => void;
  onUndo: (participantId: string) => void;
}) {
  const [game, setGame] = useState(state.period);
  // The place each athlete holds in each game, by the latest placement.
  const chosen = new Map<string, number>();
  for (const event of events) {
    const payload = event.payload;
    if (event.voided || payload.type !== "placement") continue;
    chosen.set(
      placeKey(payload.participantId, payload.registrationId, payload.game),
      payload.place,
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {config.games > 1 && (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">เลือกเกม</legend>
          {Array.from({ length: config.games }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              variant={n === game ? "default" : "outline"}
              onClick={() => setGame(n)}
              aria-pressed={n === game}
            >
              เกมที่ {n}
            </Button>
          ))}
        </fieldset>
      )}
      <ul className="flex flex-col gap-2">
        {sides.map((side) => {
          const participant = state.participants.find((p) => p.participantId === side.id);
          return (
            <li key={side.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
              <div className="flex items-center gap-3">
                <span className="w-8 text-center text-2xl font-semibold tabular-nums">
                  {participant?.rank ?? "–"}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{side.name}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {resultText(config, participant)}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={disabled}
                  aria-label={`ยกเลิกรายการล่าสุดของ ${side.name}`}
                  onClick={() => onUndo(side.id)}
                >
                  <Undo2 />
                </Button>
              </div>
              {config.measure === "placement" ? (
                <PlacementRow
                  side={side}
                  game={game}
                  chosen={chosen}
                  places={config.placementPoints?.length ?? 16}
                  disabled={disabled}
                  onSend={onSend}
                />
              ) : (
                <ResultRow
                  measure={config.measure}
                  sideId={side.id}
                  name={side.name}
                  disabled={disabled}
                  onSend={onSend}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function resultText(
  config: RaceConfig,
  participant: MatchState["participants"][number] | undefined,
) {
  if (!participant) return "";
  const status = participant.detail?.status;
  if (status && status !== "ok") return RACE_STATUS_LABELS[status];
  if (participant.score !== null) return `${participant.score} คะแนน`;
  if (participant.resultValue !== null && config.measure !== "placement") {
    return formatRaceValue(config.measure, participant.resultValue);
  }
  return "";
}

function ResultRow({
  measure,
  sideId,
  name,
  disabled,
  onSend,
}: {
  measure: "time" | "distance";
  sideId: string;
  name: string;
  disabled: boolean;
  onSend: (payload: ScoreEventPayload) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const value = parseRaceInput(measure, text);
  const save = () => {
    if (value === null) return;
    onSend({ type: "result", participantId: sideId, value, status: "ok" });
    setText("");
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {measure === "time" ? `เวลาของ ${name}` : `ระยะของ ${name}`}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={measure === "time" ? "เช่น 10.98 หรือ 1:02.35" : "เมตร เช่น 6.45"}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-invalid={text !== "" && value === null}
        className="h-11 min-w-0 flex-1 text-lg"
        disabled={disabled}
      />
      <Button type="submit" size="lg" disabled={disabled || value === null}>
        บันทึก
      </Button>
      {(["dns", "dnf", "dq"] as const).map((status) => (
        <Button
          key={status}
          type="button"
          variant="outline"
          size="lg"
          disabled={disabled}
          title={RACE_STATUS_LABELS[status]}
          onClick={() => onSend({ type: "result", participantId: sideId, value: null, status })}
        >
          {status.toUpperCase()}
        </Button>
      ))}
    </form>
  );
}

const placeKey = (participantId: string, registrationId: string | null, game: number) =>
  `${participantId}|${registrationId ?? ""}|${game}`;

function PlacementRow({
  side,
  game,
  chosen,
  places,
  disabled,
  onSend,
}: {
  side: ScoreboardSide;
  game: number;
  chosen: ReadonlyMap<string, number>;
  places: number;
  disabled: boolean;
  onSend: (payload: ScoreEventPayload) => void;
}) {
  // Per athlete when the team list is known, else one place for the side.
  const rows = side.players.length
    ? side.players.map((p) => ({ id: p.registrationId, label: p.displayName }))
    : [{ id: null, label: side.name }];
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id ?? "side"} className="flex flex-wrap items-center gap-1.5">
          <span className="w-28 truncate text-sm text-muted-foreground">{row.label}</span>
          {Array.from({ length: places }, (_, i) => i + 1).map((place) => {
            const picked = chosen.get(placeKey(side.id, row.id, game)) === place;
            return (
              <Button
                key={place}
                size="icon"
                variant={picked ? "default" : "outline"}
                aria-pressed={picked}
                disabled={disabled}
                aria-label={`${row.label} อันดับ ${place}`}
                onClick={() =>
                  onSend({
                    type: "placement",
                    participantId: side.id,
                    registrationId: row.id,
                    game,
                    place,
                  })
                }
              >
                {place}
              </Button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
