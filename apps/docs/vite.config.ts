import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { type Plugin, defineConfig } from "vite-plus";

/**
 * `fumadocs-core/server` exports a `browser` stub that throws, and the Cloudflare
 * plugin resolves the Worker with the `browser` condition. Search indexing then
 * fails on Workers with "`renderToMarkdown` is only available on the server",
 * so point server environments at the real build. In dev the import sits
 * inside pre-bundled `fumadocs-mdx`, so the dep optimizer needs it too.
 *
 * It resolves as usual and swaps the stub for its sibling, rather than calling
 * `import.meta.resolve` here: Alchemy builds under Bun, where Vite's config
 * loader rewrites that call into a module Bun cannot find.
 */
type Resolver = {
  resolve(
    id: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ): Promise<{ id: string } | null>;
};

async function resolveServerBuild(context: Resolver, id: string, importer?: string) {
  if (id !== "fumadocs-core/server") return null;
  const resolved = await context.resolve(id, importer, { skipSelf: true });
  if (!resolved) return null;
  return { ...resolved, id: resolved.id.replace(/server\.browser\.js$/, "server.js") };
}

function fumadocsServerOnWorkers(): Plugin {
  async function resolveId(this: Resolver, id: string, importer?: string) {
    return resolveServerBuild(this, id, importer);
  }
  return {
    name: "it3k:fumadocs-server-on-workers",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.config.consumer === "server",
    resolveId,
    configEnvironment: (name) =>
      name === "client"
        ? undefined
        : {
            optimizeDeps: {
              rolldownOptions: { plugins: [{ name: "it3k:fumadocs-server-deps", resolveId }] },
            },
          },
  };
}

// Deployed by `Cloudflare.Website.Vite` in packages/infra/alchemy.run.ts, which
// adds the Cloudflare plugin itself, so no Nitro preset or wrangler config here.
export default defineConfig({
  server: {
    // 3001 is web, 3002 is what a second `alchemy dev` falls back to, 3003 is the email preview.
    port: 3004,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.js",
    },
  },
  plugins: [fumadocsServerOnWorkers(), fumadocsMdx(), tailwindcss(), tanstackStart(), viteReact()],
});
