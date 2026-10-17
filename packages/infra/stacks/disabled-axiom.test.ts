import { describe, expect, test } from "bun:test";
import * as BunServices from "@effect/platform-bun/BunServices";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Axiom from "alchemy/Axiom";
import * as Plan from "alchemy/Plan";
import { findProvider } from "alchemy/Provider";
import { noopSession } from "alchemy/Report";
import { Stack } from "alchemy/Stack";
import { inMemoryState, State, type CreatedResourceState, type ResourceState } from "alchemy/State";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { disabledAxiomProviders, preserveAxiomResources } from "./disabled-axiom.ts";

const dataset: CreatedResourceState = {
  resourceType: "Axiom.Dataset",
  namespace: undefined,
  fqn: "logs",
  logicalId: "logs",
  instanceId: "dataset-instance",
  providerVersion: 0,
  status: "created",
  downstream: [],
  bindings: [],
  removalPolicy: "retain",
  props: { name: "it3k-nonprod-logs", kind: "axiom:events:v1" },
  attr: {
    id: "it3k-nonprod-logs",
    name: "it3k-nonprod-logs",
    kind: "axiom:events:v1",
    description: "Existing logs",
    edgeDeploymentUrl: "https://api.axiom.co",
  },
};

const token: CreatedResourceState = {
  ...dataset,
  resourceType: "Axiom.ApiToken",
  fqn: "logs-ingest",
  logicalId: "logs-ingest",
  instanceId: "token-instance",
  removalPolicy: "destroy",
  props: {
    name: "it3k-dev-logs-ingest",
    datasetCapabilities: { "it3k-nonprod-logs": { ingest: ["create"] } },
  },
  attr: { id: "existing-token", token: Redacted.make("saved-secret") },
};

function planDisabledAxiom(rows: Record<string, ResourceState>) {
  const stack = { name: "it3k", stage: "dev", resources: {}, bindings: {}, actions: {} };
  return Effect.gen(function* () {
    yield* preserveAxiomResources;
    const plan = yield* Plan.make({ ...stack, output: {} });
    const state = yield* yield* State;
    return { plan, saved: yield* state.get({ stack: "it3k", stage: "dev", fqn: "logs-ingest" }) };
  }).pipe(
    Effect.provide(disabledAxiomProviders),
    Effect.provide(inMemoryState({ it3k: { dev: rows } })),
    Effect.provideService(Stack, stack),
    Effect.provideService(AlchemyContext, { dotAlchemy: ".alchemy", dev: true, adopt: false }),
    Effect.provide(BunServices.layer),
    Effect.scoped,
    Effect.runPromise,
  );
}

describe("disabled Axiom in local development", () => {
  test("keeps existing live resources and the token secret without requiring Axiom credentials", async () => {
    const { plan, saved } = await planDisabledAxiom({ logs: dataset, "logs-ingest": token });
    expect(plan.resources.logs?.action).toBe("noop");
    expect(plan.resources["logs-ingest"]?.action).toBe("noop");
    expect(Object.values(plan.deletions).filter(Boolean)).toEqual([]);
    expect(plan.resources.logs?.resource.RemovalPolicy).toBe("retain");
    expect(saved).toBe(token);
  });

  test("does not provision Axiom resources in a fresh dev stack", async () => {
    const { plan } = await planDisabledAxiom({});
    expect(plan.resources).toEqual({});
    expect(Object.values(plan.deletions).filter(Boolean)).toEqual([]);
  });

  test("preserves a token even when there is no saved dataset", async () => {
    const { plan } = await planDisabledAxiom({ "logs-ingest": token });
    expect(plan.resources["logs-ingest"]?.action).toBe("noop");
    expect(plan.resources.logs).toBeUndefined();
    expect(Object.values(plan.deletions).filter(Boolean)).toEqual([]);
  });

  test("requires Axiom to be enabled to recover interrupted provisioning", async () => {
    await expect(
      planDisabledAxiom({ "logs-ingest": { ...token, status: "creating", attr: undefined } }),
    ).rejects.toThrow("Set AXIOM_DEV_ENABLED=true");
  });

  test("blocks deletion instead of silently discarding saved token state", async () => {
    const deleted = findProvider(Axiom.ApiToken).pipe(
      Effect.flatMap((provider) =>
        provider.delete({
          id: "logs-ingest",
          fqn: "logs-ingest",
          instanceId: "token-instance",
          olds: token.props as Axiom.ApiTokenProps,
          output: token.attr as Axiom.ApiToken["Attributes"],
          session: { ...noopSession, note: () => Effect.void },
          bindings: [],
        }),
      ),
      Effect.provide(disabledAxiomProviders),
      Effect.runPromise,
    );
    await expect(deleted).rejects.toThrow("Cannot delete Axiom.ApiToken");
  });
});
