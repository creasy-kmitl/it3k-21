// Each end, one side scores (petanque).
//
// A score event is one end's result: the side that won it and its points, at
// most `maxPerEnd`. An end nobody scores is skipped with a period event. The
// match is over once a side reaches `targetScore`; ends after that are left out.
import type { EndsConfig } from "./config";
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
import type { ClockState, EngineInput, MatchState, TimelineEntry } from "./types";

export function computeEnds({ config, participants, events }: EngineInput<EndsConfig>): MatchState {
  const ids = participants.map((p) => p.id);
  const totals = new Map<string, number>(ids.map((id) => [id, 0]));
  // Points per side for each end played.
  const ends: Map<string, number>[] = [];
  const stats = new StatCounter();
  const timeline: TimelineEntry[] = [];
  let clock: ClockState | null = null;
  let decided = false;

  for (const event of liveEvents(events)) {
    const payload = event.payload;
    const end = ends.length + 1;
    const stat = statEntry(event, end, stats);
    if (stat) {
      timeline.push(stat);
      continue;
    }
    if (payload.type === "clock") {
      clock = replayClock(payload, event.createdAt);
      continue;
    }
    if (decided) continue;
    if (payload.type === "period") {
      // Ends before the one named are over, without points.
      if (payload.period <= end) continue;
      while (ends.length + 1 < payload.period) ends.push(new Map());
      timeline.push(timelineEntry(event, payload.period, `เริ่มเอนด์ที่ ${payload.period}`));
    } else if (payload.type === "score" && totals.has(payload.participantId)) {
      const id = payload.participantId;
      const points = Math.min(payload.points, config.maxPerEnd);
      ends.push(new Map([[id, points]]));
      const total = (totals.get(id) ?? 0) + points;
      totals.set(id, total);
      if (total >= config.targetScore) decided = true;
      timeline.push(
        timelineEntry(event, end, `+${points} (เอนด์ที่ ${end})`, id, payload.registrationId),
      );
    }
  }

  const ranks = rankBy(ids, (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  return {
    participants: sideStates(
      participants,
      (id) => ({
        score: totals.get(id) ?? 0,
        detail: withStats({ parts: ends.map((end) => end.get(id) ?? 0) }, stats.for(id)),
        rank: decided ? (ranks.get(id) ?? null) : null,
      }),
      decided,
    ),
    period: decided ? ends.length : ends.length + 1,
    phase: "regular",
    decided,
    clock,
    timeline,
  };
}
