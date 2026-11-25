// Only who won each game counts (ROV, tug-of-war, a relay run in rounds).
//
// The scorer records each game's winner, or, with `fromSubMatches`, each
// finished sub-match counts as one game (table tennis team rubbers). The match
// is over once a side has won `gamesToWin` games; games after that are left out.
import type { SeriesConfig } from "./config";
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

export function computeSeries({
  config,
  participants,
  events,
  subMatches = [],
}: EngineInput<SeriesConfig>): MatchState {
  const ids = participants.map((p) => p.id);
  const won = new Map<string, number>(ids.map((id) => [id, 0]));
  // Each played game's winner, in order.
  const games: string[] = [];
  const stats = new StatCounter();
  const timeline: TimelineEntry[] = [];
  let clock: ClockState | null = null;
  let decided = false;

  const addGame = (winner: string) => {
    if (decided || !won.has(winner)) return false;
    games.push(winner);
    const wins = (won.get(winner) ?? 0) + 1;
    won.set(winner, wins);
    if (wins >= config.gamesToWin) decided = true;
    return true;
  };

  if (config.fromSubMatches) {
    for (const sub of subMatches) {
      if (sub.winnerParticipantId) addGame(sub.winnerParticipantId);
    }
  }

  for (const event of liveEvents(events)) {
    const payload = event.payload;
    const stat = statEntry(event, games.length + 1, stats);
    if (stat) {
      timeline.push(stat);
    } else if (payload.type === "clock") {
      clock = replayClock(payload, event.createdAt);
    } else if (payload.type === "game" && !config.fromSubMatches) {
      const game = games.length + 1;
      if (addGame(payload.participantId)) {
        timeline.push(
          timelineEntry(event, game, `ชนะ${config.gameLabel}ที่ ${game}`, payload.participantId),
        );
      }
    }
  }

  const ranks = rankBy(ids, (a, b) => (won.get(b) ?? 0) - (won.get(a) ?? 0));
  return {
    participants: sideStates(
      participants,
      (id) => ({
        score: won.get(id) ?? 0,
        detail: withStats(
          { parts: games.map((winner) => (winner === id ? 1 : 0)), won: won.get(id) ?? 0 },
          stats.for(id),
        ),
        rank: decided ? (ranks.get(id) ?? null) : null,
      }),
      decided,
    ),
    period: decided ? games.length : games.length + 1,
    phase: "regular",
    decided,
    clock,
    timeline,
  };
}
