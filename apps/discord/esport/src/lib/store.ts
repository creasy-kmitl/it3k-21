// The bot's only local state: which mode /mode last picked. Everything else
// comes from apps/server, so this stays a single key/value table.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { type Mode, isMode } from "./mode";

const MODE_KEY = "mode";

export type ModeStore = {
  get(): Mode;
  set(mode: Mode): void;
  close(): void;
};

/** `path` may be ":memory:" (tests). `fallback` applies until a mode is set. */
export function createModeStore(path: string, fallback: Mode): ModeStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  const select = db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?");
  const upsert = db.query<unknown, [string, string]>(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  return {
    get() {
      const value = select.get(MODE_KEY)?.value;
      // A value from an older build that no longer names a mode falls back.
      return isMode(value) ? value : fallback;
    },
    set(mode) {
      upsert.run(MODE_KEY, mode);
    },
    close() {
      db.close();
    },
  };
}
