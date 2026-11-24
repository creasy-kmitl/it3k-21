// Teams of each division: their members, officials and match lineups.
// Owned by the teams stream (B1).
import { Hono } from "hono";

import {
  type CurrentUserEnv,
  type RouteDeps,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";

export const createCompetitionTeamRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>().use(requireJsonPosts).use(requireUser(deps)).use(requireMember);

export type CompetitionTeamRoutes = ReturnType<typeof createCompetitionTeamRoutes>;
