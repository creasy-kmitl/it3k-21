import { describe, expect, test } from "bun:test";
import type { ScoreEventInput } from "@it3k/db/competition-rules";

import { ApiError } from "./leadership";
import { type QueueItem, ScoreQueue, queueKey } from "./offline-queue";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

let n = 0;
const ev = (): ScoreEventInput => {
  n += 1;
  return {
    id: `id-${n}`,
    clientAt: n,
    payload: { type: "score", participantId: "a", points: 1, registrationId: null },
  };
};

/** A sender whose calls are recorded; set `fail` to make the next calls throw it. */
function fakeSender() {
  const calls: (string[] | string)[] = [];
  const sender = {
    calls,
    fail: null as unknown,
    async addEvents(events: ScoreEventInput[]) {
      if (sender.fail) throw sender.fail;
      calls.push(events.map((e) => e.id));
      return "ok";
    },
    async voidEvent(id: string) {
      if (sender.fail) throw sender.fail;
      calls.push(`void:${id}`);
      return "ok";
    },
  };
  return sender;
}

describe("ScoreQueue", () => {
  test("events are sent in order and the queue empties", async () => {
    const sender = fakeSender();
    const storage = memoryStorage();
    const queue = new ScoreQueue("m1", sender, {}, storage);
    const [a, b] = [ev(), ev()];
    queue.add(a);
    queue.add(b);
    await queue.flush();
    expect(sender.calls.flat()).toEqual([a.id, b.id]);
    expect(queue.pending).toEqual([]);
    expect(storage.data.has(queueKey("m1"))).toBe(false);
  });

  test("without a connection taps wait on the phone, survive a reload and go later", async () => {
    const sender = fakeSender();
    sender.fail = new TypeError("Failed to fetch");
    const storage = memoryStorage();
    const statuses: number[] = [];
    const queue = new ScoreQueue(
      "m1",
      sender,
      { onStatus: (s) => statuses.push(s.pending) },
      storage,
      60_000,
    );
    const [a, b] = [ev(), ev()];
    queue.add(a, b);
    await queue.flush();
    expect(queue.status()).toMatchObject({ pending: 2, offline: true });
    expect(statuses).toContain(2);
    queue.stop();

    // The page reloads: a new queue picks up what was saved.
    sender.fail = null;
    const reloaded = new ScoreQueue("m1", sender, {}, storage);
    expect(reloaded.pending).toHaveLength(2);
    await reloaded.flush();
    expect(sender.calls).toEqual([[a.id, b.id]]);
    expect(reloaded.status()).toMatchObject({ pending: 0, offline: false });
  });

  test("undo of an unsent tap drops it; undo of a sent one goes to the server in order", async () => {
    const sender = fakeSender();
    sender.fail = new TypeError("offline");
    const queue = new ScoreQueue("m1", sender, {}, memoryStorage(), 60_000);
    const [a, b] = [ev(), ev()];
    queue.add(a, b);
    // The failed send is over, so neither tap is on its way any more.
    await queue.flush();
    queue.void(b.id);
    queue.void("server-event");
    queue.void("server-event");
    expect(queue.pendingEvents.map((e) => e.id)).toEqual([a.id]);
    expect([...queue.pendingVoids]).toEqual(["server-event"]);
    sender.fail = null;
    await queue.flush();
    expect(sender.calls).toEqual([[a.id], "void:server-event"]);
    queue.stop();
  });

  test("undo of a tap already on its way is sent as a void", async () => {
    let release: (value: string) => void = () => undefined;
    const calls: string[] = [];
    const sender = {
      addEvents: (events: ScoreEventInput[]) => {
        calls.push(...events.map((e) => e.id));
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
      voidEvent: async (id: string) => {
        calls.push(`void:${id}`);
        return "ok";
      },
    };
    const queue = new ScoreQueue("m1", sender, {}, memoryStorage());
    const a = ev();
    queue.add(a);
    queue.void(a.id);
    release("ok");
    await queue.flush();
    await queue.flush();
    expect(calls).toEqual([a.id, `void:${a.id}`]);
  });

  test("an event the server refuses is dropped and reported; the rest still go", async () => {
    const [bad, good] = [ev(), ev()];
    const sent: string[][] = [];
    const sender = {
      async addEvents(events: ScoreEventInput[]) {
        if (events.some((e) => e.id === bad.id)) {
          throw new ApiError(400, "แต้มนี้ไม่ตรงกับปุ่มที่ตั้งไว้", { eventId: bad.id });
        }
        sent.push(events.map((e) => e.id));
        return "ok";
      },
      voidEvent: async () => "ok",
    };
    const rejected: QueueItem[][] = [];
    const synced: string[] = [];
    const queue = new ScoreQueue(
      "m1",
      sender,
      { onRejected: (_e, items) => rejected.push(items), onSynced: (r) => synced.push(r) },
      memoryStorage(),
    );
    queue.add(bad, good);
    await queue.flush();
    expect(rejected).toEqual([[{ kind: "event", event: bad }]]);
    expect(sent).toEqual([[good.id]]);
    expect(synced).toEqual(["ok"]);
    expect(queue.pending).toEqual([]);
  });

  test("a signed-out session keeps the taps for after signing in", async () => {
    const sender = fakeSender();
    sender.fail = new ApiError(401, "signed out", null);
    const queue = new ScoreQueue("m1", sender, {}, memoryStorage(), 60_000);
    queue.add(ev());
    await queue.flush();
    expect(queue.status()).toMatchObject({ pending: 1, offline: true });
    queue.stop();
  });
});
