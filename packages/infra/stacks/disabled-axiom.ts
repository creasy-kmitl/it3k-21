import * as Axiom from "alchemy/Axiom";
import * as Provider from "alchemy/Provider";
import { retain } from "alchemy/RemovalPolicy";
import type { ResourceClass, ResourceLike } from "alchemy/Resource";
import { Stack } from "alchemy/Stack";
import { isActionState, State } from "alchemy/State";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const enableAxiom = (operation: string) =>
  Effect.die(new Error(`Cannot ${operation} while Axiom is disabled. Set AXIOM_DEV_ENABLED=true.`));

// Disabled logging must not turn saved cloud resources into deletions. These
// providers only reuse persisted outputs; they never call Axiom or resolve auth.
function preservedProvider<R extends ResourceLike>(resource: ResourceClass<R>) {
  return Provider.succeed(resource, {
    read: ({ output }) => Effect.succeed(output),
    diff: ({ output }) =>
      output === undefined ? enableAxiom(`recover ${resource.Type}`) : Effect.void,
    reconcile: ({ output }) =>
      output === undefined ? enableAxiom(`create ${resource.Type}`) : Effect.succeed(output),
    delete: () => enableAxiom(`delete ${resource.Type}`),
  });
}

export const disabledAxiomProviders = Layer.effect(
  Axiom.Providers,
  Provider.collection([Axiom.Dataset, Axiom.ApiToken]),
).pipe(
  Layer.provide(
    Layer.mergeAll(preservedProvider(Axiom.Dataset), preservedProvider(Axiom.ApiToken)),
  ),
);

export const preserveAxiomResources = Effect.gen(function* () {
  const { name: stack, stage } = yield* Stack;
  const state = yield* yield* State;
  for (const [fqn, resource] of [
    ["logs", Axiom.Dataset],
    ["logs-ingest", Axiom.ApiToken],
  ] as const) {
    const saved = yield* state.get({ stack, stage, fqn }).pipe(Effect.orDie);
    if (saved === undefined) continue;
    if (
      isActionState(saved) ||
      saved.resourceType !== resource.Type ||
      (saved.status !== "created" && saved.status !== "updated")
    ) {
      yield* enableAxiom(`recover ${fqn}`);
      continue;
    }
    // Props come from Alchemy's own persisted resource state, rather than the
    // current desired configuration, so disabling logs cannot change them.
    if (resource === Axiom.Dataset) {
      yield* Axiom.Dataset(fqn, saved.props as Axiom.DatasetProps).pipe(
        retain(saved.removalPolicy === "retain"),
      );
    } else {
      yield* Axiom.ApiToken(fqn, saved.props as Axiom.ApiTokenProps).pipe(
        retain(saved.removalPolicy === "retain"),
      );
    }
  }
});
