import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "varlock/auto-load";
import { OWNER, REPOSITORY, ZONE } from "./repo.ts";

/**
 * Public hostnames, derived from the stage so every environment gets its own
 * pair and no two stages fight over the same record.
 *
 *   prod    -> it3k.creasy.club      / it3k-api.creasy.club
 *   pr-42   -> it3k-pr-42.creasy.club / it3k-api-pr-42.creasy.club
 *
 * Read synchronously from `ALCHEMY_STAGE` because `domain` is a plain prop,
 * not an Input. CI sets that variable instead of passing `--stage`.
 *
 * Gated on `GITHUB_ACTIONS` as well, so only CI can ever claim one of these.
 * An unset `ALCHEMY_STAGE` is too weak a guard on its own: a stray export or
 * a sourced `.env` is enough for a laptop to attach `it3k.creasy.club` to its
 * own `live_$USER` worker. That is not hypothetical — it is how prod's
 * hostnames ended up held by `live_suwizx`, and Cloudflare refuses to move a
 * hostname from one Worker to another (`WorkerProvider.ts` raises a hard
 * `Effect.die`), so recovering means deploying the squatting stage again with
 * no hostname. Local deploys stay on workers.dev.
 */
const hostnames = (() => {
  if (!process.env.GITHUB_ACTIONS) return undefined;
  const stage = process.env.ALCHEMY_STAGE;
  if (!stage) return undefined;
  if (stage === "prod") return { web: `it3k.${ZONE}`, api: `it3k-api.${ZONE}` };
  const slug = stage
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { web: `it3k-${slug}.${ZONE}`, api: `it3k-api-${slug}.${ZONE}` };
})();

export const db = Cloudflare.D1.Database("database", {
  migrations: "../../packages/db/src/migrations",
});

/**
 * Axiom's Personal plan caps the whole org at three datasets, so a dataset
 * per stage does not fit: staging tried to create `it3k-staging-logs` while
 * the pr-1 preview still held a slot, and Axiom answered 400. Stages now
 * share two datasets split by tier, which leaves a slot spare no matter how
 * many previews are open at once:
 *
 *   prod           -> it3k-prod-logs
 *   staging, pr-*  -> it3k-nonprod-logs
 *
 * Stages pooled into one dataset stay separable at query time through the
 * `environment` field on every event — see the DEPLOY_ENV binding below.
 */
export const observability = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const tier = stage === "prod" ? "prod" : "nonprod";
  const datasetName = `it3k-${tier}-logs`;

  const dataset = yield* Axiom.Dataset("logs", {
    name: datasetName,
    kind: "axiom:events:v1",
    description: `it3k application logs (${tier})`,
  }).pipe(
    // The provider marks ownership by stamping the creating stage into the
    // dataset's description, so the second stage to reach a shared dataset
    // reads it as someone else's and refuses it. Every stage in a tier is a
    // legitimate owner here, so let them take it over in turn.
    Alchemy.AdoptPolicy.adopt(),
    // `alchemy destroy` on a closed PR must not take staging's logs with it.
    // Both datasets are meant to outlive every stage that writes to them.
    //
    // Caveat: retain also applies to the old generation of a replacement, so
    // a stage whose state still holds a per-stage dataset orphans it on the
    // rename instead of deleting it. Clear those out in the Axiom UI once.
    Alchemy.RemovalPolicy.retain(),
  );
  // Scoped per stage, not per tier: a token is cheap, is not subject to the
  // dataset limit, and its secret is only readable at creation — so a closed
  // PR can revoke its own without stranding the stages that share the dataset.
  const ingest = yield* Axiom.ApiToken("logs-ingest", {
    name: `it3k-${stage}-logs-ingest`,
    datasetCapabilities: {
      [datasetName]: {
        ingest: ["create"],
      },
    },
  });

  return {
    dataset,
    runtimeEnv: {
      AXIOM_API_KEY: ingest.token,
      AXIOM_DATASET: dataset.name,
      AXIOM_EDGE_URL: dataset.edgeDeploymentUrl,
      // Lands on every event as evlog's `environment`. The dataset narrows a
      // query to a tier; this narrows it to a single stage (`staging` vs
      // `pr-42`), which the dataset name no longer encodes.
      DEPLOY_ENV: stage,
    },
  };
});

export const observabilityEnv = observability.pipe(Effect.map(({ runtimeEnv }) => runtimeEnv));

export const observabilityBindings = {
  AXIOM_API_KEY: observabilityEnv.pipe(Effect.map(({ AXIOM_API_KEY }) => AXIOM_API_KEY)),
  AXIOM_DATASET: observabilityEnv.pipe(Effect.map(({ AXIOM_DATASET }) => AXIOM_DATASET)),
  AXIOM_EDGE_URL: observabilityEnv.pipe(Effect.map(({ AXIOM_EDGE_URL }) => AXIOM_EDGE_URL)),
  DEPLOY_ENV: observabilityEnv.pipe(Effect.map(({ DEPLOY_ENV }) => DEPLOY_ENV)),
};

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    DB: db,
    // The web worker is created after this one, so its URL can't be referenced
    // here without a cycle — deriving both from the stage breaks it. Without a
    // stage there is no public hostname yet, so point at the local dev port.
    CORS_ORIGIN: hostnames ? `https://${hostnames.web}` : "http://localhost:3001",
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    GOOGLE_CLIENT_ID: Config.string("GOOGLE_CLIENT_ID"),
    GOOGLE_SECRET_ID: Config.redacted("GOOGLE_SECRET_ID"),
    ...observabilityBindings,
  },
  dev: {
    port: 3000,
  },
  // `?? null` matters: alchemy reads `domain: undefined` as "don't manage
  // custom domains" and leaves whatever is attached in place, while `null`
  // explicitly detaches. Without it a stage that once held a hostname keeps
  // it forever — which is how `live_suwizx` is still squatting on prod's.
  domain: hostnames?.api ?? null,
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "it3k",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Axiom.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const observabilityResources = yield* observability;
    const serverWorker = yield* server;
    const webWorker = yield* Cloudflare.Website.Vite("web", {
      rootDir: "../../apps/web",
      compatibility: {
        flags: ["nodejs_compat"],
      },
      env: {
        ...observabilityBindings,
        VITE_SERVER_URL: serverWorker.url.as<string>(),
        // apps/web types its env from `vite/client`, not the worker bindings,
        // so the stage reaches it the same way the API URL does: only
        // `VITE_`-prefixed keys are inlined into `import.meta.env`.
        VITE_DEPLOY_ENV: observabilityBindings.DEPLOY_ENV,
      },
      dev: {
        port: 3001,
      },
      domain: hostnames?.web ?? null,
    });

    // Keeping the logical id stable means each push edits the same comment
    // instead of piling a new one onto the PR.
    if (process.env.PULL_REQUEST) {
      yield* GitHub.Comment("preview-comment", {
        owner: OWNER,
        repository: REPOSITORY,
        issueNumber: Number(process.env.PULL_REQUEST),
        body: Output.interpolate`## Preview deployed

**Web:** ${webWorker.url}
**API:** ${serverWorker.url}

Stage \`${process.env.ALCHEMY_STAGE}\` — built from commit ${process.env.GITHUB_SHA?.slice(0, 7)}.

---
_This comment updates automatically with each push, and the stage is destroyed when the PR closes._`,
      });
    }

    return {
      web: webWorker.url,
      server: serverWorker.url,
      axiomDataset: observabilityResources.dataset.name,
    };
  }),
);
