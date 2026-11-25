// The scorer's data: the server's scoreboard plus the taps still waiting in the
// offline queue, replayed with the same engine the server uses. The screen
// always shows the score as if every tap had already arrived.
import type { MatchState, ScoreEventPayload, ScoreEventRecord } from "@it3k/db/competition-rules";
import { computeMatchState } from "@it3k/db/scoring/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useApis } from "@/lib/api-context";
import type { Scoreboard } from "@/lib/competition-scores";
import { type QueueStatus, ScoreQueue } from "@/lib/offline-queue";

type Queued = {
  status: QueueStatus;
  events: { id: string; clientAt: number; payload: ScoreEventPayload }[];
  voids: Set<string>;
};
const EMPTY_QUEUE: Queued = {
  status: { pending: 0, sending: false, offline: false },
  events: [],
  voids: new Set(),
};

export const scoreboardKey = (matchId: string) => ["competition-scores", matchId] as const;

/** Server events with queued undos applied, then queued taps after them. */
export function mergeEvents(
  server: readonly ScoreEventRecord[],
  pending: readonly { id: string; clientAt: number; payload: ScoreEventPayload }[],
  pendingVoids: ReadonlySet<string>,
): ScoreEventRecord[] {
  const known = new Set(server.map((event) => event.id));
  const lastSeq = server.reduce((max, event) => Math.max(max, event.seq), 0);
  return [
    ...server.map((event) => (pendingVoids.has(event.id) ? { ...event, voided: true } : event)),
    ...pending
      .filter((event) => !known.has(event.id))
      .map((event, index) => ({
        id: event.id,
        seq: lastSeq + index + 1,
        payload: event.payload,
        voided: false,
        createdAt: event.clientAt,
      })),
  ];
}

/** The latest event that still counts, for one side or for anyone; clock taps are skipped. */
export function lastUndoable(events: readonly ScoreEventRecord[], participantId?: string) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.voided || event.payload.type === "clock") continue;
    if (participantId === undefined) return event;
    if ("participantId" in event.payload && event.payload.participantId === participantId) {
      return event;
    }
  }
  return null;
}

export function useScorer(matchId: string) {
  const { competitionScores: api } = useApis();
  const queryClient = useQueryClient();
  const key = scoreboardKey(matchId);
  const board = useQuery({
    queryKey: key,
    queryFn: () => api.get(matchId),
    // Another scorer may be keeping the same match.
    refetchInterval: (query) => (query.state.data?.match.status === "live" ? 10_000 : false),
  });
  const [queued, setQueued] = useState<Queued>(EMPTY_QUEUE);
  const queueRef = useRef<ScoreQueue<Scoreboard> | null>(null);

  useEffect(() => {
    const queue: ScoreQueue<Scoreboard> = new ScoreQueue<Scoreboard>(
      matchId,
      {
        addEvents: (events) => api.addEvents(matchId, events),
        voidEvent: (eventId) => api.voidEvent(matchId, eventId),
      },
      {
        onStatus: (status) =>
          setQueued({ status, events: queue.pendingEvents, voids: queue.pendingVoids }),
        onSynced: (result) => queryClient.setQueryData(scoreboardKey(matchId), result),
        onRejected: (error) => toast.error(`ไม่ได้บันทึกบางรายการ: ${error.message}`),
      },
    );
    queueRef.current = queue;
    setQueued({ status: queue.status(), events: queue.pendingEvents, voids: queue.pendingVoids });
    void queue.flush();
    const online = () => void queue.flush();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      queue.stop();
      queueRef.current = null;
    };
  }, [api, matchId, queryClient]);

  const data = board.data;
  const { status } = queued;
  const events = useMemo(
    () => (data ? mergeEvents(data.events, queued.events, queued.voids) : []),
    [data, queued],
  );
  const state: MatchState | null = useMemo(() => {
    if (!data) return null;
    if (status.pending === 0) return data.state;
    return computeMatchState({
      config: data.scoring,
      participants: data.sides.map((side) => ({ id: side.id })),
      events,
      // A series of sub-matches has no taps: the server's state is the state.
    });
  }, [data, events, status.pending]);

  const send = useCallback((...payloads: ScoreEventPayload[]) => {
    queueRef.current?.add(
      ...payloads.map((payload) => ({ id: crypto.randomUUID(), clientAt: Date.now(), payload })),
    );
  }, []);

  const undo = useCallback(
    (participantId?: string) => {
      const target = lastUndoable(events, participantId);
      if (target) queueRef.current?.void(target.id);
      return target !== null;
    },
    [events],
  );

  const replace = useCallback(
    (next: Scoreboard) => queryClient.setQueryData(scoreboardKey(matchId), next),
    [matchId, queryClient],
  );

  return {
    board,
    state,
    events,
    status,
    send,
    undo,
    replace,
    flush: () => queueRef.current?.flush(),
  };
}

export type Scorer = ReturnType<typeof useScorer>;
