/// <reference types="@cloudflare/workers-types" />
// For Cloudflare Workers, env is accessed via cloudflare:workers module.
// Its types come from cloudflare-env.d.ts (inferred from the alchemy.run.ts
// bindings); this type-only re-export pulls that file in and is erased at build.
export type { CloudflareEnv } from "../cloudflare-env";
export { env } from "cloudflare:workers";
