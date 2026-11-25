// Builds score event logs for engine tests: `log.score("a", 2)` appends an event
// with the next seq, and `log.events` hands them to an engine.
import type { ScoreEventPayload, ScoreEventRecord } from "./types";

export function eventLog() {
  const events: ScoreEventRecord[] = [];
  const add = (payload: ScoreEventPayload) => {
    const seq = events.length + 1;
    const event = { id: `e${seq}`, seq, payload, voided: false, createdAt: 1_000 * seq };
    events.push(event);
    return event;
  };
  return {
    events,
    add,
    score: (participantId: string, points = 1, registrationId: string | null = null) =>
      add({ type: "score", participantId, points, registrationId }),
    /** `n` single points for a side. */
    rally: (participantId: string, n: number) => {
      for (let i = 0; i < n; i++)
        add({ type: "score", participantId, points: 1, registrationId: null });
    },
    period: (period: number) => add({ type: "period", period }),
    game: (participantId: string) => add({ type: "game", participantId }),
    shootout: (participantId: string, scored: boolean) =>
      add({ type: "shootout", participantId, scored }),
    stat: (participantId: string, stat: "foul" | "timeout" | "yellow" | "red") =>
      add({ type: "stat", participantId, stat, registrationId: null }),
    result: (
      participantId: string,
      value: number | null,
      status: "ok" | "dns" | "dnf" | "dq" = "ok",
    ) => add({ type: "result", participantId, value, status }),
    place: (
      participantId: string,
      game: number,
      place: number,
      registrationId: string | null = null,
    ) => add({ type: "placement", participantId, registrationId, game, place }),
    clock: (action: "start" | "pause" | "reset", seconds: number) =>
      add({ type: "clock", action, seconds }),
    void: (event: ScoreEventRecord) => {
      event.voided = true;
    },
  };
}

export const sides = (...ids: string[]) => ids.map((id) => ({ id }));
