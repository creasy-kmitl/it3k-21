import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "drizzle-kit";

// Local D1 database created by `alchemy dev` (miniflare stores it as a hashed .sqlite file).
const d1Dir = resolve(
  import.meta.dirname,
  "../infra/.alchemy/local/d1/cloudflare-runtime-D1DatabaseObject",
);

// Stale databases from earlier dev sessions can linger here, so pick the one written to most
// recently. Miniflare runs SQLite in WAL mode, so recent writes only touch the -wal file.
function lastWrite(file: string) {
  const wal = `${file}-wal`;
  return Math.max(statSync(file).mtimeMs, existsSync(wal) ? statSync(wal).mtimeMs : 0);
}

function findLocalD1() {
  const files = existsSync(d1Dir)
    ? readdirSync(d1Dir)
        .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
        .map((name) => resolve(d1Dir, name))
    : [];
  if (files.length === 0) {
    throw new Error(`No local D1 database found in ${d1Dir}. Run \`bun run dev\` once first.`);
  }
  return files.reduce((latest, file) => (lastWrite(file) > lastWrite(latest) ? file : latest));
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${findLocalD1()}`,
  },
});
