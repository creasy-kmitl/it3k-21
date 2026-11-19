import { defineConfig } from "drizzle-kit";

import { findLocalD1 } from "./src/local-d1";

// Local D1 database created by `alchemy dev` (miniflare stores it as a hashed .sqlite file).
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${findLocalD1()}`,
  },
});
