// Sets of points (badminton, table tennis, a Valorant map per set).
//
// Each rally is one point. A set goes to the side that reaches `pointsPerSet`
// with a lead of `winBy`, or that reaches `cap` first whatever the lead. The
// next point after a set starts the next one, and the match is over once a side
// has won `setsToWin` sets. Points after that are left out.
import type { SetsConfig } from "./config";
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

/** The line the timeline shows when a set reaches its break. */
export const INTERVAL_TEXT = "พักระหว่างเกม";

/** Whether `mine` against the best of the others wins the set. */
export function wonSet(config: SetsConfig, mine: number, best: number): boolean {
  if (config.cap !== null && mine >= config.cap) return true;
  return mine >= config.pointsPerSet && mine - best >= config.winBy;
}

export function computeSets({ config, participants, events }: EngineInput<SetsConfig>): MatchState {
  const ids = participants.map((p) => p.id);
  // Points per side in each set, the current set last.
  const sets: Map<string, number>[] = [new Map(ids.map((id) => [id, 0]))];
  const won = new Map<string, number>(ids.map((id) => [id, 0]));
  const stats = new StatCounter();
  const timeline: TimelineEntry[] = [];
  let clock: ClockState | null = null;
  let decided = false;
  let intervalTaken = false;

  const current = () => sets[sets.length - 1] as Map<string, number>;

  for (const event of liveEvents(events)) {
    const payload = event.payload;
    const set = sets.length;
    const stat = statEntry(event, set, stats);
    if (stat) {
      timeline.push(stat);
      continue;
    }
    if (payload.type === "clock") {
      clock = replayClock(payload, event.createdAt);
      continue;
    }
    if (payload.type !== "score" || decided || !won.has(payload.participantId)) continue;

    const id = payload.participantId;
    const points = current();
    const mine = (points.get(id) ?? 0) + 1;
    points.set(id, mine);
    timeline.push(timelineEntry(event, set, "+1", id, payload.registrationId));

    const best = Math.max(0, ...ids.filter((other) => other !== id).map((o) => points.get(o) ?? 0));
    if (wonSet(config, mine, best)) {
      const wins = (won.get(id) ?? 0) + 1;
      won.set(id, wins);
      const score = ids.map((side) => points.get(side) ?? 0).join("-");
      timeline.push(timelineEntry(event, set, `จบ${config.setLabel}ที่ ${set} (${score})`, id));
      if (wins >= config.setsToWin) decided = true;
      else startSet();
    } else if (
      !intervalTaken &&
      config.intervalAt !== null &&
      mine === config.intervalAt &&
      mine > best
    ) {
      intervalTaken = true;
      timeline.push(timelineEntry(event, set, INTERVAL_TEXT));
    }
  }

  function startSet() {
    sets.push(new Map(ids.map((id) => [id, 0])));
    intervalTaken = false;
  }

  const ranks = rankBy(ids, (a, b) => (won.get(b) ?? 0) - (won.get(a) ?? 0));
  return {
    participants: sideStates(
      participants,
      (id) => ({
        score: won.get(id) ?? 0,
        detail: withStats(
          { parts: sets.map((set) => set.get(id) ?? 0), won: won.get(id) ?? 0 },
          stats.for(id),
        ),
        rank: decided ? (ranks.get(id) ?? null) : null,
      }),
      decided,
    ),
    period: sets.length,
    phase: "regular",
    decided,
    clock,
    timeline,
  };
}

/** Whether the set being played is at its break: the last line is the break. */
export function atInterval(state: MatchState): boolean {
  return !state.decided && state.timeline.at(-1)?.text === INTERVAL_TEXT;
}
