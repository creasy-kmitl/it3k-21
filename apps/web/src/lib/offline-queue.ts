// The scorer's outbox. Every tap is saved on the phone first and sent in order
// when the connection allows, so a court with poor signal never loses a point.
// Events carry ids made here, and the API skips ids it already has, so sending
// a batch twice (say the reply was lost) cannot count twice.
import type { ScoreEventInput } from "@it3k/db/competition-rules";

import { ApiError } from "./leadership";

export type QueueItem =
  | { kind: "event"; event: ScoreEventInput }
  // Undo of an event the server already has.
  | { kind: "void"; eventId: string };

export type QueueSender<T> = {
  addEvents: (events: ScoreEventInput[]) => Promise<T>;
  voidEvent: (eventId: string) => Promise<T>;
};

export type QueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type QueueStatus = {
  pending: number;
  sending: boolean;
  // The last failure that is being retried (no signal, server down).
  offline: boolean;
};

const MAX_BATCH = 100;

/** Failures worth retrying: no connection, a timeout or the server's own fault. */
export function isRetryable(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return (
    error.status >= 500 || error.status === 408 || error.status === 429 || error.status === 401
  );
}

export const queueKey = (matchId: string) => `it3k:score-queue:${matchId}`;

export class ScoreQueue<T> {
  private items: QueueItem[];
  private running: Promise<void> | null = null;
  private offline = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  // The batch on its way to the server: undoing one of these must go to the server.
  private inFlight = new Set<QueueItem>();

  constructor(
    private readonly matchId: string,
    private readonly sender: QueueSender<T>,
    private readonly hooks: {
      onStatus?: (status: QueueStatus) => void;
      // The server's answer after a send went through.
      onSynced?: (result: T) => void;
      // Items the server refused for good (a closed match, a bad event).
      onRejected?: (error: ApiError, items: QueueItem[]) => void;
    } = {},
    private readonly storage: QueueStorage | null = typeof localStorage === "undefined"
      ? null
      : localStorage,
    private readonly retryMs = 3000,
  ) {
    this.items = this.load();
  }

  /** What has not reached the server yet, oldest first. */
  get pending(): readonly QueueItem[] {
    return this.items;
  }

  /** Events waiting to be sent, in order. */
  get pendingEvents(): ScoreEventInput[] {
    return this.items.flatMap((item) => (item.kind === "event" ? [item.event] : []));
  }

  /** Ids of server events whose undo is waiting to be sent. */
  get pendingVoids(): Set<string> {
    return new Set(this.items.flatMap((item) => (item.kind === "void" ? [item.eventId] : [])));
  }

  status(): QueueStatus {
    return { pending: this.items.length, sending: this.running !== null, offline: this.offline };
  }

  add(...events: ScoreEventInput[]) {
    this.items.push(...events.map((event) => ({ kind: "event" as const, event })));
    this.changed();
    void this.flush();
  }

  /** Undo: an event still waiting here is simply dropped; else the server voids it. */
  void(eventId: string) {
    const index = this.items.findIndex(
      (item) => item.kind === "event" && item.event.id === eventId,
    );
    const item = this.items[index];
    if (item && !this.inFlight.has(item)) this.items.splice(index, 1);
    else if (!this.pendingVoids.has(eventId)) this.items.push({ kind: "void", eventId });
    this.changed();
    void this.flush();
  }

  /** Sends everything in order; resolves when the queue is empty or must wait. */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    // A send already running may have started before the latest tap: go again after it.
    if (this.running)
      return this.running.then(() => (this.items.length ? this.flush() : undefined));
    clearTimeout(this.timer);
    this.running = this.drain().finally(() => {
      this.running = null;
      this.emit();
      if (this.items.length && this.offline && !this.stopped) {
        this.timer = setTimeout(() => void this.flush(), this.retryMs);
      }
    });
    this.emit();
    return this.running;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async drain() {
    while (this.items.length && !this.stopped) {
      const first = this.items[0] as QueueItem;
      const batch: QueueItem[] =
        first.kind === "void" ? [first] : this.takeWhile((item) => item.kind === "event");
      this.inFlight = new Set(batch);
      try {
        const result =
          first.kind === "void"
            ? await this.sender.voidEvent(first.eventId)
            : await this.sender.addEvents(
                batch.flatMap((item) => (item.kind === "event" ? [item.event] : [])),
              );
        this.offline = false;
        // The server's answer first, so the screen never shows the batch as neither sent nor pending.
        this.hooks.onSynced?.(result);
        this.remove(batch);
      } catch (error) {
        if (isRetryable(error) || !(error instanceof ApiError)) {
          this.offline = true;
          return;
        }
        // The server refused for good. Drop only the event it named when it
        // named one, so the rest still go through.
        const named = eventIdOf(error);
        const refused = named
          ? batch.filter((item) => item.kind === "event" && item.event.id === named)
          : batch;
        this.remove(refused.length ? refused : batch);
        this.hooks.onRejected?.(error, refused.length ? refused : batch);
      } finally {
        this.inFlight = new Set();
      }
    }
  }

  private takeWhile(test: (item: QueueItem) => boolean) {
    const batch: QueueItem[] = [];
    for (const item of this.items) {
      if (!test(item) || batch.length >= MAX_BATCH) break;
      batch.push(item);
    }
    return batch;
  }

  private remove(done: QueueItem[]) {
    const gone = new Set(done);
    this.items = this.items.filter((item) => !gone.has(item));
    this.changed();
  }

  private changed() {
    this.save();
    this.emit();
  }

  private emit() {
    this.hooks.onStatus?.(this.status());
  }

  private load(): QueueItem[] {
    try {
      const raw = this.storage?.getItem(queueKey(this.matchId));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
    } catch {
      return [];
    }
  }

  private save() {
    try {
      if (this.items.length) {
        this.storage?.setItem(queueKey(this.matchId), JSON.stringify(this.items));
      } else {
        this.storage?.removeItem(queueKey(this.matchId));
      }
    } catch {
      // Storage full or blocked: the queue still works while the page is open.
    }
  }
}

function eventIdOf(error: ApiError): string | null {
  const body = error.body;
  if (body && typeof body === "object" && "eventId" in body && typeof body.eventId === "string") {
    return body.eventId;
  }
  return null;
}
