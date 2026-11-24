// Public competition pages, read without signing in: matches, the live board,
// standings and medals. Athletes appear by first name and shirt number only.
// Owned by the public stream (B5).
import { Hono } from "hono";

import type { RouteDeps } from "../../middleware/current-user";

export const createPublicCompetitionRoutes = (_deps: Pick<RouteDeps, "getDb">) => new Hono();

export type PublicCompetitionRoutes = ReturnType<typeof createPublicCompetitionRoutes>;
