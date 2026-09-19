import handler from "@tanstack/react-start/server-entry";
import { createAxiomDrain } from "evlog/axiom";
import { initWorkersLogger, withEvlog } from "evlog/workers";

// Stages share a dataset per tier, so the stage name is what separates
// `staging` from `pr-42` in Axiom. Inlined at build time by alchemy.run.ts.
initWorkersLogger({
  env: { service: "it3k-web", environment: import.meta.env.VITE_DEPLOY_ENV },
});

export default withEvlog(
  async (request) => {
    return handler.fetch(request);
  },
  { drain: createAxiomDrain() },
);
