// Goals and baskets added up over periods (football, basketball, chairball).
//
// The scorer moves to the next period by hand; moving past the last regular
// period ends regular time. A level score then goes on to overtime or a
// shootout when the match needs a winner, or stands as a draw when it may.
// With a target score the match ends as soon as a side reaches it.
import type { PointsConfig } from "./config";
import {
  StatCounter,
  liveEvents,
  rankBy,
  replayClock,
  sideStates,
  statEntry,
  timelineEntry,
  withStats,
} from "./shared";
import type { ClockState, EngineInput, MatchPhase, MatchState, TimelineEntry } from "./types";

type Shootout = { scored: number; taken: number };

/** Whether a shootout is over, and who won it, by the kicks taken so far. */
export function shootoutWinner(a: Shootout, b: Shootout, kicks: number): "a" | "b" | null {
  if (a.taken <= kicks && b.taken <= kicks) {
    // Within the regular kicks: over once one side cannot catch up.
    if (a.scored > b.scored + (kicks - b.taken)) return "a";
    if (b.scored > a.scored + (kicks - a.taken)) return "b";
    return null;
  }
  // Sudden death: decided after a round where only one side scored.
  if (a.taken !== b.taken || a.scored === b.scored) return null;
  return a.scored > b.scored ? "a" : "b";
}

const periodClock = (config: PointsConfig, period: number): ClockState | null => {
  if (!config.clock) return null;
  const overtime = period > config.periods.count;
  const seconds = overtime
    ? (config.clock.overtimeSeconds ?? config.clock.periodSeconds)
    : config.clock.periodSeconds;
  return { running: false, seconds, startedAt: null };
};

/** The name of period `n`, e.g. "ครึ่งที่ 2" or "ต่อเวลา 1". */
export function pointsPeriodLabel(config: PointsConfig, n: number): string {
  if (n <= config.periods.count) {
    return config.periods.count === 1 ? config.periods.label : `${config.periods.label}ที่ ${n}`;
  }
  const label = config.overtime?.label ?? "ต่อเวลา";
  return `${label} ${n - config.periods.count}`;
}

export function computePoints({
  config,
  participants,
  events,
}: EngineInput<PointsConfig>): MatchState {
  const ids = participants.map((p) => p.id);
  const totals = new Map<string, number>(ids.map((id) => [id, 0]));
  const parts = new Map<string, number[]>(ids.map((id) => [id, []]));
  const shootouts = new Map<string, Shootout>(ids.map((id) => [id, { scored: 0, taken: 0 }]));
  const stats = new StatCounter();
  const timeline: TimelineEntry[] = [];
  let period = 1;
  let highestScored = 0;
  let clock: ClockState | null = periodClock(config, 1);
  let shootoutStarted = false;
  // Whether the score was level when the scorer last moved on a period.
  let levelAtBoundary = true;

  const level = () => new Set(totals.values()).size <= 1;
  const needsWinner = () => !config.allowDraw || shootoutStarted;

  for (const event of liveEvents(events)) {
    const payload = event.payload;
    const stat = statEntry(event, period, stats);
    if (stat) {
      timeline.push(stat);
      continue;
    }
    switch (payload.type) {
      case "score": {
        const id = payload.participantId;
        const sideParts = parts.get(id);
        if (!sideParts) break;
        totals.set(id, (totals.get(id) ?? 0) + payload.points);
        sideParts[period - 1] = (sideParts[period - 1] ?? 0) + payload.points;
        highestScored = Math.max(highestScored, period);
        timeline.push(
          timelineEntry(event, period, `+${payload.points}`, id, payload.registrationId),
        );
        break;
      }
      case "period": {
        if (payload.period === period) break;
        period = payload.period;
        levelAtBoundary = level();
        clock = periodClock(config, period);
        const overtime =
          period > config.periods.count &&
          levelAtBoundary &&
          !config.allowDraw &&
          config.overtime !== null &&
          !shootoutStarted;
        const text =
          period > config.periods.count && !overtime
            ? "หมดเวลาการแข่งขัน"
            : `เริ่ม${pointsPeriodLabel(config, period)}`;
        timeline.push(timelineEntry(event, period, text));
        break;
      }
      case "shootout": {
        const tally = shootouts.get(payload.participantId);
        if (!tally || !config.shootout) break;
        shootoutStarted = true;
        tally.taken += 1;
        if (payload.scored) tally.scored += 1;
        const text = `${config.shootout.label}${payload.scored ? "เข้า" : "ไม่เข้า"}`;
        timeline.push(timelineEntry(event, period, text, payload.participantId));
        break;
      }
      case "clock":
        clock = replayClock(payload, event.createdAt);
        break;
      default:
        break;
    }
  }

  // Whether the rules say the match is over, and in which phase it stands.
  const regularOver = period > config.periods.count;
  let phase: MatchPhase = "regular";
  let decided = false;
  let shootoutWin: string | null = null;
  const best = Math.max(0, ...totals.values());
  const sorted = [...totals.values()].sort((a, b) => b - a);
  const lead = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  if (
    config.targetScore !== null &&
    best >= config.targetScore &&
    lead >= (config.targetWinBy ?? 1)
  ) {
    decided = true;
  } else if (regularOver && !levelAtBoundary) {
    // A period ended with one side ahead: regular time, or an overtime period.
    decided = true;
    if (period - 1 > config.periods.count) phase = "overtime";
  } else if (regularOver) {
    if (shootoutStarted && config.shootout && ids.length === 2) {
      phase = "shootout";
      const [a, b] = ids as [string, string];
      const winner = shootoutWinner(
        shootouts.get(a) as Shootout,
        shootouts.get(b) as Shootout,
        config.shootout.kicks,
      );
      shootoutWin = winner === "a" ? a : winner === "b" ? b : null;
      decided = shootoutWin !== null;
    } else if (!needsWinner()) {
      decided = true;
    } else if (config.overtime) {
      phase = "overtime";
    } else if (config.shootout) {
      phase = "shootout";
    }
  }

  const ranks = rankBy(ids, (a, b) => {
    const byScore = (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
    if (byScore !== 0 || !level()) return byScore;
    return (b === shootoutWin ? 1 : 0) - (a === shootoutWin ? 1 : 0);
  });
  // Periods played so far; past regular time, moving on closes the last one.
  const played = !regularOver ? period : phase === "overtime" && !decided ? period : period - 1;
  const partCount = Math.max(highestScored, played);

  return {
    participants: sideStates(
      participants,
      (id) => {
        const sideParts = Array.from({ length: partCount }, (_, i) => parts.get(id)?.[i] ?? 0);
        const tally = shootouts.get(id) as Shootout;
        return {
          score: totals.get(id) ?? 0,
          detail: withStats(
            { parts: sideParts, ...(shootoutStarted ? { shootout: { ...tally } } : {}) },
            stats.for(id),
          ),
          rank: decided ? (ranks.get(id) ?? null) : null,
        };
      },
      decided,
    ),
    period,
    phase,
    decided,
    clock,
    timeline,
  };
}
