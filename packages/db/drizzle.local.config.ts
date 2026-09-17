import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "drizzle-kit";

// Local D1 database created by `alchemy dev` (miniflare stores it as a hashed .sqlite file).
const d1Dir = resolve(
  import.meta.dirname,
  "../infra/.alchemy/local/d1/cloudflare-runtime-D1DatabaseObject",
);

function findLocalD1() {
  const file = readdirSync(d1Dir).find(
    (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
  );
  if (!file) {
    throw new Error(`No local D1 database found in ${d1Dir}. Run \`bun run dev\` once first.`);
  }
  return resolve(d1Dir, file);
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${findLocalD1()}`,
  },
});
