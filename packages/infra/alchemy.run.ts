import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "varlock/auto-load";

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
    CORS_ORIGIN: Config.string("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
    GOOGLE_CLIENT_ID: Config.string("GOOGLE_CLIENT_ID"),
    GOOGLE_SECRET_ID: Config.redacted("GOOGLE_SECRET_ID"),
    ...observabilityBindings,
  },
  dev: {
    port: 3000,
  },
  domain:"it3k-api.creasy.club"
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "it3k",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Axiom.providers()),
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
      domain: "it3k.creasy.club",
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
      axiomDataset: observabilityResources.dataset.name,
    };
  }),
);
