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
 * not an Input. CI sets that variable instead of passing `--stage`. Local
 * deploys leave it unset and stay on workers.dev, so a laptop can never take
 * over a real hostname (and `live_$USER` isn't a legal hostname anyway).
 */
const hostnames = (() => {
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

export const observability = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const datasetName = `it3k-${stage}-logs`;

  const dataset = yield* Axiom.Dataset("logs", {
    name: datasetName,
    kind: "axiom:events:v1",
    description: "it3k application logs",
  });
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
    },
  };
});

export const observabilityEnv = observability.pipe(Effect.map(({ runtimeEnv }) => runtimeEnv));

export const observabilityBindings = {
  AXIOM_API_KEY: observabilityEnv.pipe(Effect.map(({ AXIOM_API_KEY }) => AXIOM_API_KEY)),
  AXIOM_DATASET: observabilityEnv.pipe(Effect.map(({ AXIOM_DATASET }) => AXIOM_DATASET)),
  AXIOM_EDGE_URL: observabilityEnv.pipe(Effect.map(({ AXIOM_EDGE_URL }) => AXIOM_EDGE_URL)),
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
  domain: hostnames?.api,
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
      },
      dev: {
        port: 3001,
      },
      domain: hostnames?.web,
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
