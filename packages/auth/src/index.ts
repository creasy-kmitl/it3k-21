import type { Database } from "@it3k/db";
import * as schema from "@it3k/db/schema/auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";

import { DEFAULT_ROLE, ac, roles } from "./permissions";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_SECRET_ID: string;
  /**
   * The server that owns the Google redirect URI this stage signs in through.
   *
   * Google matches redirect URIs byte for byte -- no wildcards, no regex --
   * so `it3k-api-pr-7.creasy.club`, which exists only while PR #7 is open,
   * can never be registered. Stages with a stable hostname (prod, staging,
   * localhost) each own a registered URI and set this to their own
   * `BETTER_AUTH_URL`, which makes {@link oAuthProxy} a no-op; only `pr-*`
   * points it at the relay.
   */
  AUTH_PROXY_URL: string;
  /**
   * Shared by every stage taking part in the proxy flow so the relay's
   * encrypted profile payload can be opened by the preview that started it.
   */
  OAUTH_PROXY_SECRET: string;
  /** Comma-separated origin patterns; set only on the relay stage. */
  AUTH_PREVIEW_ORIGINS?: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      // Populated only on the stage that relays OAuth for previews: it is the
      // one that has to redirect a browser back to `it3k-pr-7.creasy.club`
      // once Google calls it. Better Auth matches these as wildcards -- which
      // is precisely what Google will not do, and the reason a relay exists.
      // Empty everywhere else, so no other stage widens its redirect surface.
      ...(env.AUTH_PREVIEW_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ],
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_SECRET_ID,
      },
    },
    user: {
      additionalFields: {
        departmentId: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Surface auth failures on the web login page instead of Better Auth's default error page.
    onAPIError: {
      errorURL: `${env.CORS_ORIGIN.replace(/\/$/, "")}/login`,
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [
      admin({
        ac,
        roles,
        defaultRole: DEFAULT_ROLE,
        adminRoles: ["admin"],
      }),
      // Unconditional on purpose. The plugin skips proxying when
      // `productionURL` equals this stage's own `baseURL`, which is the case
      // for prod, staging and a laptop -- so they all run the same plugin
      // list and the same code path, and only `pr-*` actually proxies.
      oAuthProxy({
        productionURL: env.AUTH_PROXY_URL,
        // Deliberately not BETTER_AUTH_SECRET. The relay and the preview must
        // hold the same key here, and sharing the session-signing secret
        // across stages would let any preview mint cookies prod accepts.
        secret: env.OAUTH_PROXY_SECRET,
        // Replay window for the encrypted profile handed back to the preview.
        maxAge: 60,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
