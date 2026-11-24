// Checking athletes in to matches at the venue kiosk or by hand (esports, via
// Discord), and forfeiting no-shows. Owned by the check-in stream (B4).
import { Hono } from "hono";

import {
  type CurrentUserEnv,
  type RouteDeps,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";

export const createCompetitionCheckinRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>().use(requireJsonPosts).use(requireUser(deps)).use(requireMember);

export type CompetitionCheckinRoutes = ReturnType<typeof createCompetitionCheckinRoutes>;
