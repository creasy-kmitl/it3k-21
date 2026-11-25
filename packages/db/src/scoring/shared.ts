// Pieces every scoring engine shares: replaying events in order, counting
// stats, the optional clock, ranking and the Thai lines of the timeline.
import type { ScoringConfig, ScoringEngine } from "./config";
import type {
  ClockState,
  EngineParticipant,
  ParticipantDetail,
  ParticipantOutcome,
  ParticipantState,
  ScoreEventPayload,
  ScoreEventRecord,
  ScoreEventType,
  ScoreStat,
  TimelineEntry,
} from "./types";

/** The event types each engine reads; the API refuses the others. */
export const ENGINE_EVENT_TYPES: Record<ScoringEngine, readonly ScoreEventType[]> = {
  points: ["score", "period", "shootout", "stat", "clock"],
  sets: ["score", "stat", "clock"],
  series: ["game", "stat", "clock"],
  ends: ["score", "period", "stat", "clock"],
  race: ["result", "placement", "stat", "clock"],
};

export const STAT_LABELS: Record<ScoreStat, string> = {
  foul: "ฟาวล์",
  timeout: "ขอเวลานอก",
  yellow: "ใบเหลือง",
  red: "ใบแดง",
};

/**
 * Why an event does not fit the match's settings, or null when it does. The
 * engines skip what does not fit, so the API checks first and says why.
 */
export function eventProblem(
  config: ScoringConfig,
  payload: ScoreEventPayload,
  participantIds: readonly string[],
): string | null {
  if (!ENGINE_EVENT_TYPES[config.engine].includes(payload.type)) {
    return "การให้คะแนนแบบนี้ไม่รับรายการประเภทนี้";
  }
  if ("participantId" in payload && !participantIds.includes(payload.participantId)) {
    return "ไม่พบฝ่ายนี้ในแมตช์";
  }
  if (payload.type === "score") {
    if (config.engine === "points" && !config.buttons.includes(payload.points)) {
      return "แต้มนี้ไม่ตรงกับปุ่มที่ตั้งไว้";
    }
    if (config.engine === "sets" && payload.points !== 1) return "เพิ่มได้ครั้งละ 1 แต้ม";
    if (config.engine === "ends" && payload.points > config.maxPerEnd) {
      return `เอนด์หนึ่งได้ไม่เกิน ${config.maxPerEnd} แต้ม`;
    }
  }
  if (payload.type === "shootout" && (config.engine !== "points" || !config.shootout)) {
    return "แมตช์นี้ไม่มีการยิงโทษ";
  }
  if (payload.type === "placement" && config.engine === "race") {
    if (config.measure !== "placement") return "แมตช์นี้ไม่ได้นับอันดับในเกม";
    if (payload.game > config.games) return `แมตช์นี้มี ${config.games} เกม`;
  }
  if (payload.type === "result" && config.engine === "race" && config.measure === "placement") {
    return "แมตช์นี้นับอันดับในเกม ไม่ใช่เวลาหรือระยะ";
  }
  if (payload.type === "result" && payload.status === "ok" && payload.value === null) {
    return "ใส่ผลก่อนบันทึก";
  }
  return null;
}

/** The events that still count, in the order the server took them. */
export function liveEvents(events: readonly ScoreEventRecord[]): ScoreEventRecord[] {
  return events.filter((event) => !event.voided).sort((a, b) => a.seq - b.seq);
}

/** Fouls, timeouts and cards per side. */
export class StatCounter {
  private counts = new Map<string, Partial<Record<ScoreStat, number>>>();

  add(participantId: string, stat: ScoreStat) {
    const counts = this.counts.get(participantId) ?? {};
    counts[stat] = (counts[stat] ?? 0) + 1;
    this.counts.set(participantId, counts);
  }

  for(participantId: string): Partial<Record<ScoreStat, number>> | undefined {
    return this.counts.get(participantId);
  }
}

/** The clock as its events left it; null when nobody used one. */
export function replayClock(
  event: Extract<ScoreEventPayload, { type: "clock" }>,
  at: number,
): ClockState {
  return event.action === "start"
    ? { running: true, seconds: event.seconds, startedAt: at }
    : { running: false, seconds: event.seconds, startedAt: null };
}

export function timelineEntry(
  event: ScoreEventRecord,
  period: number,
  text: string,
  participantId: string | null = null,
  registrationId: string | null = null,
): TimelineEntry {
  return { eventId: event.id, at: event.createdAt, period, participantId, text, registrationId };
}

/** A timeline line for a stat event, or null for events that are not stats. */
export function statEntry(
  event: ScoreEventRecord,
  period: number,
  stats: StatCounter,
): TimelineEntry | null {
  const payload = event.payload;
  if (payload.type !== "stat") return null;
  stats.add(payload.participantId, payload.stat);
  return timelineEntry(
    event,
    period,
    STAT_LABELS[payload.stat],
    payload.participantId,
    payload.registrationId,
  );
}

/**
 * Standard competition ranks (1, 1, 3) by `compare`, which sorts better sides
 * first. Sides `compare` cannot place (it returns null for them) get no rank.
 */
export function rankBy<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number,
  rankable: (item: T) => boolean = () => true,
): Map<T, number> {
  const ranked = items.filter(rankable).sort(compare);
  const ranks = new Map<T, number>();
  ranked.forEach((item, index) => {
    const previous = ranked[index - 1];
    const tied = previous !== undefined && compare(previous, item) === 0;
    ranks.set(item, tied ? (ranks.get(previous) ?? index + 1) : index + 1);
  });
  return ranks;
}

/** Win, loss or draw from final ranks: sides sharing first place drew. */
export function outcomeFor(
  rank: number | null,
  ranks: readonly (number | null)[],
): ParticipantOutcome {
  if (rank !== 1) return "loss";
  return ranks.filter((r) => r === 1).length > 1 ? "draw" : "win";
}

/** Builds each side's state in slot order. */
export function sideStates(
  participants: readonly EngineParticipant[],
  build: (id: string) => {
    score: number | null;
    detail: ParticipantDetail;
    resultValue?: number | null;
    rank?: number | null;
  },
  decided: boolean,
): ParticipantState[] {
  const built = participants.map((p) => ({ id: p.id, ...build(p.id) }));
  const ranks = built.map((side) => side.rank ?? null);
  return built.map((side) => ({
    participantId: side.id,
    score: side.score,
    detail: side.detail,
    resultValue: side.resultValue ?? null,
    rank: side.rank ?? null,
    outcome: decided ? outcomeFor(side.rank ?? null, ranks) : null,
  }));
}

/** Drops empty stats so a detail stays small. */
export function withStats(
  detail: ParticipantDetail,
  stats: Partial<Record<ScoreStat, number>> | undefined,
): ParticipantDetail {
  return stats ? { ...detail, stats } : detail;
}
