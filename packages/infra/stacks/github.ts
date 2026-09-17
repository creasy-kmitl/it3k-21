import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";
import { OWNER, REPOSITORY } from "../repo.ts";

/**
 * One-shot stack: mints the scoped Cloudflare API token GitHub Actions
 * deploys with, and pushes it (plus the app's own secrets) into the repo's
 * Actions secrets. Run it from a laptop under an elevated profile:
 *
 *   AXIOM_TOKEN=... alchemy deploy --config stacks/github.ts --profile admin
 *
 * Re-run only to rotate the token or change its permissions.
 */
export default Alchemy.Stack(
  "github",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;

    const apiToken = yield* Cloudflare.ApiToken.AccountApiToken("CIToken", {
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "Workers Scripts Write",
            "Workers KV Storage Write",
            "Workers R2 Storage Write",
            "Workers Routes Write",
            "Workers Tail Read",
            "D1 Write",
            "Queues Write",
            "Secrets Store Write",
            "Account Settings Write",
          ],
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
        },
        {
          // Each stage claims its own *.creasy.club hostname, which means CI
          // has to create DNS records and edge certificates on the zone.
          effect: "allow",
          permissionGroups: ["Zone Read", "DNS Write", "SSL and Certificates Write"],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: {
              "com.cloudflare.api.account.zone.*": "*",
            },
          },
        },
      ],
    });

    yield* GitHub.Secrets({
      owner: OWNER,
      repository: REPOSITORY,
      secrets: {
        CLOUDFLARE_API_TOKEN: apiToken.value,
        // Not secret in the cryptographic sense, but keeping it here means all
        // CI configuration lives in one place instead of leaking into YAML.
        CLOUDFLARE_ACCOUNT_ID: Redacted.make(accountId),
        BETTER_AUTH_SECRET: yield* Config.redacted("BETTER_AUTH_SECRET"),
        GOOGLE_CLIENT_ID: Redacted.make(yield* Config.string("GOOGLE_CLIENT_ID")),
        GOOGLE_SECRET_ID: yield* Config.redacted("GOOGLE_SECRET_ID"),
        // Axiom credentials live in the alchemy profile store locally, so this
        // one has to be passed in explicitly when deploying this stack.
        AXIOM_TOKEN: yield* Config.redacted("AXIOM_TOKEN"),
      },
    });
  }),
);
