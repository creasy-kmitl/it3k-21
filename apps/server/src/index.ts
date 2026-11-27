import { initLogger } from "evlog";
import { createAxiomDrain } from "evlog/axiom";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { waitUntil } from "cloudflare:workers";

import { env } from "./env.server";
import type { RouteDeps } from "./middleware/current-user";
import { createCalendarRoutes } from "./routes/calendar";
import { createDepartmentRoutes } from "./routes/departments";
import { createLinkRoutes } from "./routes/links";
import { createShortLinkRedirect } from "./routes/links/redirect";
import { createQrPresetRoutes } from "./routes/qr-presets";
import { createSportRuleRoutes } from "./routes/sport-rules";
import { createSportRoutes } from "./routes/sports";
import { createRegistrationRoutes } from "./routes/registrations";
import { createAthleteRoutes } from "./routes/athletes";
import { createEventRoutes } from "./routes/events";
import { createPublicEventRoutes } from "./routes/public-events";
import { createCompetitionDivisionRoutes } from "./routes/competition-divisions";
import { createCompetitionTeamRoutes } from "./routes/competition-teams";
import { createCompetitionMatchRoutes } from "./routes/competition-matches";
import { createCompetitionScoreRoutes } from "./routes/competition-scores";
import { createCompetitionCheckinRoutes } from "./routes/competition-checkins";
import { createPublicCompetitionRoutes } from "./routes/public-competition";
import { createTicketRoutes } from "./routes/tickets";
import { createBotRoutes } from "./routes/bot";
import { createBotTokenRoutes } from "./routes/bot-tokens";
import { createVenueRoutes } from "./routes/venues";
import type { DiscordDeps } from "./routes/registrations/shared";
import { discordEnabled } from "@it3k/auth";
import { createUserRoutes } from "./routes/users";
import { createLeadershipRoutes, recordContactReveal } from "./routes/leadership";
import { createAuth, getDb, guildConfig } from "./services";
import { DiscordApiError, addGuildMember, guildUrl } from "./discord/guild";
import { createProfileRoutes } from "./routes/profile";
import { createViewAsRoutes } from "./routes/view-as";
import { cleanupImpersonationSessions, handleAuthRequest } from "./routes/auth-audit";
import { cleanupFiles, createFileRoutes, createPublicFileRoutes } from "./routes/files";
import { createFileStore } from "./routes/files/storage";
import { cleanupExpiredSessions, purgeExpiredPersonalData } from "./retention";
import { createEmailRoutes } from "./routes/emails";
import { createInvitationRoutes } from "./routes/invitations";
import { createQueueMailer, type MailDeps } from "./email/mailer";
import { handleEmailBatch, type JobMessage } from "./email/consumer";
import type { EmailJob } from "@it3k/email/jobs";
import { createLogger } from "evlog";

initLogger({
  // Stages share a dataset per tier, so the stage name is what separates
  // `staging` from `pr-42` in Axiom. Bound by alchemy.run.ts.
  env: { service: "it3k-server", environment: env.DEPLOY_ENV },
});

const identifyUser = createAuthMiddleware((await createAuth()) as BetterAuthInstance, {
  // Short links are public and carry no session; skip the lookup on every visit.
  exclude: ["/api/auth/**", "/l/**", "/api/files/public/**", "/api/public/**", "/api/bot/**"],
  maskEmail: true,
});

const app = new Hono<EvlogVariables>();

app.use(
  evlog({
    drain: env.AXIOM_API_KEY && env.AXIOM_DATASET ? createAxiomDrain() : undefined,
  }),
);
app.use("*", async (c, next) => {
  await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

const privateCors = cors({
  origin: env.CORS_ORIGIN,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});
const publicCors = cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] });
// Public files and pages are read signed out from any site, so they send no cookies.
const isPublic = (path: string) =>
  path.startsWith("/api/files/public/") || path.startsWith("/api/public/");
app.use("/*", (c, next) => (isPublic(c.req.path) ? publicCors : privateCors)(c, next));

app.on(["POST", "GET"], "/api/auth/*", async (c) =>
  handleAuthRequest(c.req.raw, await createAuth(), c.get("log")),
);

const deps: RouteDeps = {
  getSession: async (headers) => {
    const session = await (await createAuth()).api.getSession({ headers });
    if (!session) return null;
    return {
      userId: session.user.id,
      impersonatedBy: session.session.impersonatedBy ?? null,
      createdAt: new Date(session.session.createdAt),
    };
  },
  getDb,
  // A key of its own, so a view-as cookie can never pass for an auth cookie.
  viewAsSecret: `${env.BETTER_AUTH_SECRET}:view-as`,
};

const mailDeps: MailDeps = { mailer: createQueueMailer(env.EMAIL_QUEUE) };
/** Where links in emails point, and where uploaded images in them are served from. */
const emailContext = { webOrigin: env.CORS_ORIGIN, apiOrigin: new URL(env.BETTER_AUTH_URL).origin };

app.route("/api/departments", createDepartmentRoutes(deps));
app.route("/api/users", createUserRoutes(deps));
app.route("/api/invitations", createInvitationRoutes({ ...deps, ...mailDeps }));
app.route("/api/view-as", createViewAsRoutes(deps));
app.route("/api/bot-tokens", createBotTokenRoutes(deps));
const fileDeps = { ...deps, getStore: () => createFileStore(env.UPLOADS), waitUntil };
app.route("/api/files/public", createPublicFileRoutes(fileDeps));
app.route("/api/files", createFileRoutes(fileDeps));
app.route(
  "/api/leadership",
  createLeadershipRoutes({
    ...deps,
    audit: async (c, event) => recordContactReveal(c.var.log, event),
  }),
);

app.route("/api/calendar", createCalendarRoutes(deps));
app.route("/api/links", createLinkRoutes({ ...deps, webOrigin: env.CORS_ORIGIN }));
app.route("/api/qr-presets", createQrPresetRoutes(deps));
app.route("/api/sports", createSportRoutes(deps));
app.route("/api/sport-rules", createSportRuleRoutes(deps));
const guild = guildConfig();
const discordDeps: DiscordDeps = {
  discordEnabled: discordEnabled(env),
  // Joins with the account's own token, refreshed by Better Auth if it expired.
  // A token it cannot get (or Discord refuses) means linking again.
  discordGuildJoin: guild
    ? async ({ headers, accountRecordId, discordUserId }) => {
        const auth = await createAuth();
        const token = await auth.api
          .getAccessToken({ headers, body: { accountId: accountRecordId } })
          .catch(() => null);
        if (!token?.accessToken) return { status: "consent" };
        try {
          const status = await addGuildMember(guild, {
            discordUserId,
            accessToken: token.accessToken,
          });
          return { status, url: guildUrl(guild.guildId) };
        } catch (error) {
          if (error instanceof DiscordApiError && error.needsConsent) return { status: "consent" };
          throw error;
        }
      }
    : null,
  // Asks Discord with the athlete's stored token; best effort.
  discordProfile: async (headers, accountId) => {
    const info = await (await createAuth()).api.accountInfo({ headers, query: { accountId } });
    const data = info?.data as { username?: unknown; global_name?: unknown } | undefined;
    if (typeof data?.username !== "string") return null;
    return {
      username: data.username,
      displayName: typeof data.global_name === "string" ? data.global_name : null,
      avatarUrl: typeof info?.user?.image === "string" ? info.user.image : null,
    };
  },
};
app.route("/api/registrations", createRegistrationRoutes({ ...deps, ...discordDeps, ...mailDeps }));
app.route("/api/profile", createProfileRoutes({ ...deps, ...discordDeps, ...mailDeps }));
app.route("/api/athletes", createAthleteRoutes({ ...deps, ...mailDeps }));
app.route("/api/venues", createVenueRoutes(deps));
app.route("/api/events", createEventRoutes(deps));
app.route("/api/tickets", createTicketRoutes({ ...deps, ...mailDeps }));
app.route("/api/emails", createEmailRoutes({ ...deps, ...mailDeps, emailContext }));
app.route("/api/competition/divisions", createCompetitionDivisionRoutes(deps));
app.route("/api/competition/teams", createCompetitionTeamRoutes(deps));
app.route("/api/competition/matches", createCompetitionMatchRoutes(deps));
app.route("/api/competition/scores", createCompetitionScoreRoutes(deps));
app.route("/api/competition/checkins", createCompetitionCheckinRoutes(deps));
// Public: link previews (Open Graph) for event pages, fetched signed out.
app.route("/api/public/events", createPublicEventRoutes(deps));
// Public: matches, the live board, standings and medals.
app.route("/api/public/competition", createPublicCompetitionRoutes(deps));

// The Discord bots, signed in with a token an admin issued (/api/bot-tokens) instead of a session.
app.route(
  "/api/bot",
  createBotRoutes({
    getDb,
    stage: env.DEPLOY_ENV ?? "dev",
    webOrigin: env.CORS_ORIGIN,
  }),
);

// Public: the web worker forwards its `/l/<slug>` paths here.
app.route("/l", createShortLinkRedirect(deps));

app.get("/", (c) => {
  return c.text("OK");
});

export default {
  fetch: app.fetch,
  async scheduled() {
    // Purge first: it hands the files it frees to cleanupFiles.
    await purgeExpiredPersonalData(getDb());
    await cleanupFiles(getDb(), createFileStore(env.UPLOADS));
    await cleanupExpiredSessions(getDb());
    await cleanupImpersonationSessions(getDb());
  },
  async queue(batch: MessageBatch<EmailJob>) {
    const log = createLogger({ email: { queue: batch.queue, size: batch.messages.length } });
    await handleEmailBatch(batch.messages as readonly JobMessage[], {
      getDb,
      ctx: emailContext,
      send: (message) => env.EMAIL.send(message),
      requeue: async (job, delaySeconds) => {
        await env.EMAIL_QUEUE.send(job, { delaySeconds, contentType: "json" });
      },
      log: {
        info: (message, fields) => log.info(message, fields),
        warn: (message, fields) => log.warn(message, fields),
      },
    });
    log.emit();
  },
};
