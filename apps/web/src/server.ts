import { SHORT_LINK_PATH } from "@it3k/db/short-link-rules";
import handler from "@tanstack/react-start/server-entry";
import { createAxiomDrain } from "evlog/axiom";
import { initWorkersLogger, withEvlog } from "evlog/workers";

import { answerShortLink } from "./lib/short-link-proxy";

/** Bindings this worker uses itself; see alchemy.run.ts. */
type WebEnv = {
  /** The API worker, which answers short links. */
  SERVER: { fetch: (request: Request) => Promise<Response> };
};

// Stages share a dataset per tier, so the stage name is what separates
// `staging` from `pr-42` in Axiom. Inlined at build time by alchemy.run.ts.
initWorkersLogger({
  env: { service: "it3k-web", environment: import.meta.env.VITE_DEPLOY_ENV },
});

export default withEvlog<WebEnv>(
  async (request, env, _ctx, log) => {
    // Short links are served on this host but answered by the API.
    if (new URL(request.url).pathname.startsWith(SHORT_LINK_PATH)) {
      return answerShortLink(
        request,
        (forwarded) => env.SERVER.fetch(forwarded),
        async (page) => handler.fetch(page),
        (error) => log.error(error instanceof Error ? error : String(error)),
      );
    }
    return handler.fetch(request);
  },
  { drain: createAxiomDrain() },
);
