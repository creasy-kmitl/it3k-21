// Routes for the Discord bots (apps/discord/*). They authenticate with the
// stage's BOT_API_TOKEN, never a session, so nothing here may depend on a
// signed-in account. The bots import `BotRoutes` by relative path for a typed
// client, so this file must not import `cloudflare:workers`.
import { Hono } from "hono";

import type { RouteDeps } from "../../middleware/current-user";
import { requireBotToken } from "../../middleware/bot-token";

export type BotDeps = Pick<RouteDeps, "getDb"> & {
  /** The stage's BOT_API_TOKEN; empty turns these routes off (404). */
  botToken: string;
  /** Deploy stage (prod, staging, pr-42, or dev), echoed so a bot can tell where it landed. */
  stage: string;
};

export const createBotRoutes = (deps: BotDeps) =>
  new Hono()
    .use(requireBotToken(() => deps.botToken))
    // A health check the bot runs on /ping and after /mode switches endpoint.
    .get("/ping", (c) => c.json({ ok: true as const, stage: deps.stage }, 200));

export type BotRoutes = ReturnType<typeof createBotRoutes>;
