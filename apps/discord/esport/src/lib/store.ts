// The bot's only local state: which mode /mode last picked, whether /init has
// run, and the ids of the Discord roles, channels and messages /init made.
// Everything else comes from apps/server.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { type Mode, isMode } from "./mode";

const MODE_KEY = "mode";
const INIT_DONE_KEY = "init_done";

export type BotStore = {
  getMode(): Mode;
  setMode(mode: Mode): void;
  /** True once /init has set the guild up; /init is then no longer registered. */
  initDone(): boolean;
  setInitDone(done: boolean): void;
  /** The Discord id /init stored under `key` (e.g. `role:staff`), if any. */
  getId(key: string): string | undefined;
  setId(key: string, id: string): void;
  deleteId(key: string): void;
  close(): void;
};

/** `path` may be ":memory:" (tests). `fallbackMode` applies until a mode is set. */
export function createBotStore(path: string, fallbackMode: Mode): BotStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run("CREATE TABLE IF NOT EXISTS discord_ids (key TEXT PRIMARY KEY, id TEXT NOT NULL)");

  const selectSetting = db.query<{ value: string }, [string]>(
    "SELECT value FROM settings WHERE key = ?",
  );
  const upsertSetting = db.query<unknown, [string, string]>(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const deleteSetting = db.query<unknown, [string]>("DELETE FROM settings WHERE key = ?");
  const selectId = db.query<{ id: string }, [string]>("SELECT id FROM discord_ids WHERE key = ?");
  const upsertId = db.query<unknown, [string, string]>(
    "INSERT INTO discord_ids (key, id) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET id = excluded.id",
  );
  const removeId = db.query<unknown, [string]>("DELETE FROM discord_ids WHERE key = ?");

  return {
    getMode() {
      const value = selectSetting.get(MODE_KEY)?.value;
      // A value from an older build that no longer names a mode falls back.
      return isMode(value) ? value : fallbackMode;
    },
    setMode(mode) {
      upsertSetting.run(MODE_KEY, mode);
    },
    initDone() {
      return selectSetting.get(INIT_DONE_KEY)?.value === "1";
    },
    setInitDone(done) {
      if (done) upsertSetting.run(INIT_DONE_KEY, "1");
      else deleteSetting.run(INIT_DONE_KEY);
    },
    getId(key) {
      return selectId.get(key)?.id;
    },
    setId(key, id) {
      upsertId.run(key, id);
    },
    deleteId(key) {
      removeId.run(key);
    },
    close() {
      db.close();
    },
  };
}
