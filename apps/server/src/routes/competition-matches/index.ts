// Matches, groups, schedules (manual or round robin with a preview), referees,
// images and final placements. Owned by the matches stream (B2).
import { Hono } from "hono";

import {
  type CurrentUserEnv,
  type RouteDeps,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";

export const createCompetitionMatchRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>().use(requireJsonPosts).use(requireUser(deps)).use(requireMember);

export type CompetitionMatchRoutes = ReturnType<typeof createCompetitionMatchRoutes>;
