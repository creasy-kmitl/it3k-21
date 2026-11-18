import type { Database } from "@it3k/db";
import * as schema from "@it3k/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";

import { DEFAULT_ROLE, ac, roles } from "./permissions";
import { acceptOnSignup, invitedDefaults, refuseSignup } from "./signup";

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
   * Optional in local development; omitting it disables the proxy plugin.
   */
  OAUTH_PROXY_SECRET?: string;
  /** Comma-separated origin patterns; set only on the relay stage. */
  AUTH_PREVIEW_ORIGINS?: string;
  /**
   * Discord OAuth app. Athletes link Discord for esports; it never signs
   * anyone in. Leaving either value empty turns Discord linking off.
   */
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
};

/**
 * How long an admin may act as another account. Better Auth sets this as the
 * impersonation session's expiry; the session hook below keeps its routine
 * refresh from pushing that out to the normal seven days, and the server's
 * requireUser checks it again against the session's creation time.
 */
export const IMPERSONATION_MAX_AGE = 60 * 60;

/**
 * Account and session endpoints an impersonated session may not call. Writes
 * through the app's own API stay open while impersonating; these would let the
 * admin reshape the target's identity instead -- linking the admin's Discord
 * to the target, changing their email, or signing them out everywhere.
 */
export const IMPERSONATION_BLOCKED_PATHS: ReadonlySet<string> = new Set([
  "/link-social",
  "/unlink-account",
  "/update-user",
  "/change-email",
  "/change-password",
  "/set-password",
  "/delete-user",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  // OAuth tokens (a Discord refresh token) would outlive the impersonation.
  "/get-access-token",
  "/refresh-token",
]);

export const IMPERSONATION_FORBIDDEN = "IMPERSONATION_FORBIDDEN";

/** Discord is only ever linked to an account that signed in with Google. */
export const DISCORD = "discord";

export function discordEnabled(
  env: Pick<AuthConfig, "DISCORD_CLIENT_ID" | "DISCORD_CLIENT_SECRET">,
) {
  return !!env.DISCORD_CLIENT_ID && !!env.DISCORD_CLIENT_SECRET;
}

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
      ...(discordEnabled(env)
        ? {
            discord: {
              clientId: env.DISCORD_CLIENT_ID ?? "",
              clientSecret: env.DISCORD_CLIENT_SECRET ?? "",
            },
          }
        : {}),
    },
    account: {
      accountLinking: {
        // A Discord account rarely uses the same address as the Google one.
        allowDifferentEmails: true,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!IMPERSONATION_BLOCKED_PATHS.has(ctx.path)) return;
        const session = await getSessionFromCtx(ctx);
        if (session?.session.impersonatedBy) {
          throw new APIError("FORBIDDEN", {
            code: IMPERSONATION_FORBIDDEN,
            message: "ทำรายการนี้ระหว่างสวมบัญชีไม่ได้ กลับสู่บัญชีของคุณก่อน",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // An invited address starts as what the invitation says (refuseSignup
          // in validateUserInfo already let it through). The admin plugin's own
          // hook only fills in the role when this one has not.
          before: async (user) => {
            const invited = await invitedDefaults(database, user.email);
            if (!invited) return;
            return { data: { ...user, ...invited } };
          },
          after: async (user, ctx) => {
            try {
              const accepted = await acceptOnSignup(database, user);
              if (!accepted) return;
              const seatTaken =
                (accepted.kind === "head" || accepted.kind === "vicehead") && !accepted.seat;
              if (seatTaken) {
                ctx?.context.logger.warn("invited seat was taken; account stays staff", accepted);
              }
            } catch (error) {
              // The account exists with the invited role either way; leaving the
              // invitation open only means it can be revoked later.
              ctx?.context.logger.error("could not mark invitation accepted", error);
            }
          },
        },
      },
      session: {
        update: {
          // A session is refreshed to a fresh seven-day expiry once it is a day
          // past its last refresh -- which an hour-long impersonation session
          // already is when it is created. Keep its original expiry instead.
          before: async (data, ctx) => {
            if (!ctx || !("expiresAt" in data)) return;
            const token = await ctx.getSignedCookie(
              ctx.context.authCookies.sessionToken.name,
              ctx.context.secret,
            );
            if (!token) return;
            const current = await ctx.context.internalAdapter.findSession(token);
            if (!current?.session.impersonatedBy) return;
            return { data: { ...data, expiresAt: current.session.expiresAt } };
          },
        },
      },
      account: {
        create: {
          // One Discord account per user: relinking means unlinking first.
          // (One user per Discord account is the (provider, account) index.)
          before: async (account, ctx) => {
            if (account.providerId !== DISCORD || !ctx) return;
            const accounts = await ctx.context.internalAdapter.findAccounts(account.userId);
            if (accounts.some((linked) => linked.providerId === DISCORD)) {
              throw new APIError("BAD_REQUEST", {
                code: "DISCORD_ALREADY_LINKED",
                message: "บัญชีนี้เชื่อม Discord ไว้แล้ว ยกเลิกการเชื่อมก่อนเชื่อมบัญชีใหม่",
              });
            }
          },
        },
      },
    },
    user: {
      // Discord only links to an account; signing up or in with it is refused.
      validateUserInfo: async ({ user, source }) => {
        if (source.oauth?.providerId === DISCORD && source.action !== "link-account") {
          return {
            error: "discord_sign_in_disabled",
            errorDescription: "เข้าสู่ระบบด้วย Google แล้วเชื่อม Discord จากหน้าสมัครกีฬา",
          };
        }
        // A first sign-in needs an institution address or an invitation.
        // Accounts an admin creates directly are exempt.
        if (source.action === "create-user" && source.method !== "admin") {
          return (await refuseSignup(database, user)) ?? undefined;
        }
      },
      additionalFields: {
        departmentId: {
          type: "string",
          required: false,
          input: false,
        },
        institution: {
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
        // Admins may not act as other admins: the admin role is not granted
        // `impersonate-admins` (see permissions.ts) and this stays false.
        allowImpersonatingAdmins: false,
        impersonationSessionDuration: IMPERSONATION_MAX_AGE,
      }),
      // Local development can use its registered Google callback directly.
      // Deployed stages require the shared secret in the Alchemy config.
      ...(env.OAUTH_PROXY_SECRET
        ? [
            oAuthProxy({
              productionURL: env.AUTH_PROXY_URL,
              // Deliberately not BETTER_AUTH_SECRET. The relay and the preview
              // must hold the same key without sharing session-signing secrets.
              secret: env.OAUTH_PROXY_SECRET,
              // Replay window for the encrypted profile handed back to the preview.
              maxAge: 60,
            }),
          ]
        : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
