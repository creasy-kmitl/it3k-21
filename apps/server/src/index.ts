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
import { createUserRoutes } from "./routes/users";
import { createLeadershipRoutes, recordContactReveal } from "./routes/leadership";
import { createAuth, getDb } from "./services";
import { createProfileRoutes } from "./routes/profile";
import { cleanupFiles, createFileRoutes, createPublicFileRoutes } from "./routes/files";
import { createFileStore } from "./routes/files/storage";

initLogger({
  // Stages share a dataset per tier, so the stage name is what separates
  // `staging` from `pr-42` in Axiom. Bound by alchemy.run.ts.
  env: { service: "it3k-server", environment: env.DEPLOY_ENV },
});

const identifyUser = createAuthMiddleware((await createAuth()) as BetterAuthInstance, {
  // Short links are public and carry no session; skip the lookup on every visit.
  exclude: ["/api/auth/**", "/l/**", "/api/files/public/**"],
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
app.use("/*", (c, next) =>
  (c.req.path.startsWith("/api/files/public/") ? publicCors : privateCors)(c, next),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

const deps: RouteDeps = {
  getSession: async (headers) => {
    const session = await (await createAuth()).api.getSession({ headers });
    if (!session) return null;
    return { userId: session.user.id, impersonatedBy: session.session.impersonatedBy ?? null };
  },
  getDb,
};

app.route("/api/departments", createDepartmentRoutes(deps));
app.route("/api/users", createUserRoutes(deps));
const fileDeps = { ...deps, getStore: () => createFileStore(env.UPLOADS), waitUntil };
app.route("/api/files/public", createPublicFileRoutes(fileDeps));
app.route("/api/files", createFileRoutes(fileDeps));
app.route("/api/profile", createProfileRoutes(deps));
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

// Public: the web worker forwards its `/l/<slug>` paths here.
app.route("/l", createShortLinkRedirect(deps));

app.get("/", (c) => {
  return c.text("OK");
});

export default {
  fetch: app.fetch,
  async scheduled() {
    await cleanupFiles(getDb(), createFileStore(env.UPLOADS));
  },
};
