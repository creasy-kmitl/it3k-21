// Node-only: finds the local D1 database that `alchemy dev` (miniflare) writes.
// Used by drizzle.local.config.ts and the docs screenshot scripts, never by Workers.
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const LOCAL_D1_DIR = resolve(
  import.meta.dirname,
  "../../infra/.alchemy/local/d1/cloudflare-runtime-D1DatabaseObject",
);

// Miniflare runs SQLite in WAL mode, so recent writes only touch the -wal file.
function lastWrite(file: string) {
  const wal = `${file}-wal`;
  return Math.max(statSync(file).mtimeMs, existsSync(wal) ? statSync(wal).mtimeMs : 0);
}

/**
 * The local D1 file. Stale databases from earlier dev sessions can linger in
 * the folder, so this picks the one written to most recently.
 */
export function findLocalD1() {
  const files = existsSync(LOCAL_D1_DIR)
    ? readdirSync(LOCAL_D1_DIR)
        .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
        .map((name) => resolve(LOCAL_D1_DIR, name))
    : [];
  if (files.length === 0) {
    throw new Error(`No local D1 database found in ${LOCAL_D1_DIR}. Run \`bun run dev\` once first.`);
  }
  return files.reduce((latest, file) => (lastWrite(file) > lastWrite(latest) ? file : latest));
}
