import { initLogger } from "evlog";
import { createAxiomDrain } from "evlog/axiom";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { env } from "./env.server";
import type { RouteDeps } from "./middleware/current-user";
import { createCalendarRoutes } from "./routes/calendar";
import { createDepartmentRoutes } from "./routes/departments";
import { createPublicCalendarRoutes } from "./routes/public-calendar";
import { createUserRoutes } from "./routes/users";
import { createLeadershipRoutes, recordContactReveal } from "./routes/leadership";
import { createAuth, getDb } from "./services";

initLogger({
  // Stages share a dataset per tier, so the stage name is what separates
  // `staging` from `pr-42` in Axiom. Bound by alchemy.run.ts.
  env: { service: "it3k-server", environment: env.DEPLOY_ENV },
});

const identifyUser = createAuthMiddleware((await createAuth()) as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

const app = new Hono<EvlogVariables>();

app.use(evlog({ drain: createAxiomDrain() }));
app.use("*", async (c, next) => {
  await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
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
app.route(
  "/api/leadership",
  createLeadershipRoutes({
    ...deps,
    audit: async (c, event) => recordContactReveal(c.var.log, event),
  }),
);

app.route("/api/calendar", createCalendarRoutes(deps));
// No sign-in: approved, confirmed live operations only.
app.route("/api/public/calendar", createPublicCalendarRoutes(deps));

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
