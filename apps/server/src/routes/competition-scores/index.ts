// Keeping score: score events, undo, starting and finishing a match, and
// results without play. Owned by the scoring stream (B3).
import { Hono } from "hono";

import {
  type CurrentUserEnv,
  type RouteDeps,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";

export const createCompetitionScoreRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>().use(requireJsonPosts).use(requireUser(deps)).use(requireMember);

export type CompetitionScoreRoutes = ReturnType<typeof createCompetitionScoreRoutes>;
