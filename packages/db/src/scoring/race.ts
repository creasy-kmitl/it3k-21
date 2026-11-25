// Several sides ranked by a time, a distance or their placings (athletics, TFT).
//
// Times and distances: a side's k-th result is its result in game k; a result
// past the last game replaces that game's, so with one game the latest result
// counts. DNS, DNF and DQ get no rank in that game. Placings: each placement
// event gives an athlete (or the side) a place in one game, and a side's game
// score adds up its athletes' placement points. Over several games the side
// winning more games wins, or the best total, as `decideBy` says.
import type { RaceConfig, RaceMeasure } from "./config";
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
import type { ClockState, EngineInput, MatchState, RaceStatus, TimelineEntry } from "./types";

export const RACE_STATUS_LABELS: Record<Exclude<RaceStatus, "ok">, string> = {
  dns: "ไม่ได้ลงแข่ง (DNS)",
  dnf: "แข่งไม่จบ (DNF)",
  dq: "ถูกตัดสิทธิ์ (DQ)",
};

/** A time in ms or a distance in mm as people read it. */
export function formatRaceValue(measure: RaceMeasure, value: number): string {
  if (measure === "distance") return `${(value / 1000).toFixed(2)} ม.`;
  if (measure === "placement") return `อันดับ ${value}`;
  if (value < 60_000) return `${(value / 1000).toFixed(2)} วิ`;
  const minutes = Math.floor(value / 60_000);
  const seconds = ((value % 60_000) / 1000).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds} นาที`;
}

type Result = { value: number | null; status: RaceStatus };

export function computeRace({ config, participants, events }: EngineInput<RaceConfig>): MatchState {
  const ids = participants.map((p) => p.id);
  const byPlacement = config.measure === "placement";
  const pointsBased = byPlacement || config.placementPoints !== null;
  const results = new Map<string, Result[]>(ids.map((id) => [id, []]));
  // Latest place per side, athlete and game.
  const places = new Map<string, { participantId: string; game: number; place: number }>();
  const stats = new StatCounter();
  const timeline: TimelineEntry[] = [];
  let clock: ClockState | null = null;
  const gameLabel = (game: number) => (config.games > 1 ? `เกมที่ ${game} ` : "");

  for (const event of liveEvents(events)) {
    const payload = event.payload;
    const stat = statEntry(event, 1, stats);
    if (stat) {
      timeline.push(stat);
    } else if (payload.type === "clock") {
      clock = replayClock(payload, event.createdAt);
    } else if (payload.type === "result" && !byPlacement) {
      const list = results.get(payload.participantId);
      if (!list) continue;
      const result = { value: payload.value, status: payload.status };
      if (list.length < config.games) list.push(result);
      else list[config.games - 1] = result;
      const text =
        payload.status === "ok" && payload.value !== null
          ? formatRaceValue(config.measure, payload.value)
          : RACE_STATUS_LABELS[payload.status === "ok" ? "dnf" : payload.status];
      timeline.push(
        timelineEntry(
          event,
          list.length,
          `${gameLabel(list.length)}${text}`,
          payload.participantId,
        ),
      );
    } else if (payload.type === "placement" && byPlacement && results.has(payload.participantId)) {
      if (payload.game > config.games) continue;
      const key = `${payload.participantId}|${payload.registrationId ?? ""}|${payload.game}`;
      places.set(key, {
        participantId: payload.participantId,
        game: payload.game,
        place: payload.place,
      });
      timeline.push(
        timelineEntry(
          event,
          payload.game,
          `${gameLabel(payload.game)}อันดับ ${payload.place}`,
          payload.participantId,
          payload.registrationId,
        ),
      );
    }
  }

  const placePoints = (place: number) =>
    config.placementPoints ? (config.placementPoints[place - 1] ?? 0) : place;
  // Within a game: placement points and distances are better higher; summed
  // places and times lower. Totals add game points when placement points apply.
  const order = (higherWins: boolean) => (a: number, b: number) => (higherWins ? b - a : a - b);
  const byValue = order(byPlacement ? config.placementPoints !== null : !config.lowerIsBetter);
  const byPoints = order(pointsBased ? config.placementPoints !== null : !config.lowerIsBetter);

  // Each game: who played it, each side's value in it, and its ranks.
  type Game = { played: Set<string>; value: Map<string, number>; status: Map<string, RaceStatus> };
  const games: Game[] = Array.from({ length: config.games }, () => ({
    played: new Set(),
    value: new Map(),
    status: new Map(),
  }));
  for (const [id, list] of results) {
    list.forEach((result, index) => {
      const game = games[index] as Game;
      game.played.add(id);
      game.status.set(id, result.status);
      if (result.status === "ok" && result.value !== null) game.value.set(id, result.value);
    });
  }
  for (const { participantId, game, place } of places.values()) {
    const entry = games[game - 1] as Game;
    entry.played.add(participantId);
    entry.value.set(participantId, (entry.value.get(participantId) ?? 0) + placePoints(place));
  }
  const gameRanks = games.map((game) =>
    rankBy(
      ids,
      (a, b) => byValue(game.value.get(a) ?? 0, game.value.get(b) ?? 0),
      (id) => game.value.has(id),
    ),
  );
  // A game's score per side: placement points earned by rank, or the value.
  const gameScore = (index: number, id: string): number | null => {
    const game = games[index] as Game;
    if (!byPlacement && config.placementPoints) {
      const rank = gameRanks[index]?.get(id);
      return rank === undefined ? (game.played.has(id) ? 0 : null) : placePoints(rank);
    }
    return game.value.get(id) ?? null;
  };

  const complete = games.map((game) => ids.every((id) => game.played.has(id)));
  const wins = new Map(
    ids.map((id) => [
      id,
      gameRanks.filter((ranks, index) => complete[index] && ranks.get(id) === 1).length,
    ]),
  );
  const totals = new Map(
    ids.map((id) => {
      const scores = games.map((_, index) => gameScore(index, id));
      if (pointsBased) return [id, scores.reduce<number>((sum, s) => sum + (s ?? 0), 0)];
      // A time or distance total needs a result in every game.
      if (scores.some((s) => s === null)) return [id, null];
      return [id, scores.reduce<number>((sum, s) => sum + (s ?? 0), 0)];
    }),
  );
  const anyResult = games.some((game) => game.played.size > 0);
  const byTotal = (a: string, b: string) => {
    const ta = totals.get(a);
    const tb = totals.get(b);
    if (ta == null || tb == null) return (ta == null ? 1 : 0) - (tb == null ? 1 : 0);
    return byPoints(ta, tb);
  };
  const ranks = rankBy(
    ids,
    config.decideBy === "gameWins"
      ? (a, b) => (wins.get(b) ?? 0) - (wins.get(a) ?? 0) || byTotal(a, b)
      : byTotal,
    (id) => anyResult && totals.get(id) != null && games.some((g) => g.played.has(id)),
  );

  const remaining = complete.filter((done) => !done).length;
  const sortedWins = [...wins.values()].sort((a, b) => b - a);
  const clinched =
    config.decideBy === "gameWins" &&
    ids.length > 1 &&
    (sortedWins[0] ?? 0) > (sortedWins[1] ?? 0) + remaining;
  const decided = complete.every(Boolean) || clinched;
  const firstOpen = complete.indexOf(false);

  return {
    participants: sideStates(
      participants,
      (id) => {
        const list = results.get(id) ?? [];
        const single = config.games === 1 ? list[0] : undefined;
        const showWins = config.games > 1 || config.decideBy === "gameWins";
        return {
          score: pointsBased
            ? (totals.get(id) ?? 0)
            : config.decideBy === "gameWins" && config.games > 1
              ? (wins.get(id) ?? 0)
              : null,
          resultValue: pointsBased ? null : (totals.get(id) ?? null),
          detail: withStats(
            {
              parts: games.map((_, index) => gameScore(index, id) ?? 0),
              ...(showWins ? { won: wins.get(id) ?? 0 } : {}),
              ...(single ? { status: single.status } : {}),
            },
            stats.for(id),
          ),
          rank: ranks.get(id) ?? null,
        };
      },
      decided,
    ),
    period: firstOpen === -1 ? config.games : firstOpen + 1,
    phase: "regular",
    decided,
    clock,
    timeline,
  };
}
