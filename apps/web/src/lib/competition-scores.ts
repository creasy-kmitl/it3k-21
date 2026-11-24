// The scoring stream (B3) fills this client in.
import type { ClientRequestOptions, hc } from "hono/client";

import type { CompetitionScoreRoutes } from "../../../server/src/routes/competition-scores";
import { ENV } from "../env.public";

/** The typed client the methods call: hc<CompetitionScoreRoutes>(`${baseUrl}/api/competition/scores`, { credentials: "include" }). */
export type Client = ReturnType<typeof hc<CompetitionScoreRoutes>>;

export function createCompetitionScoresApi(
  _baseUrl: string,
  _fetchImpl?: ClientRequestOptions["fetch"],
) {
  return {};
}

export type CompetitionScoresApi = ReturnType<typeof createCompetitionScoresApi>;

export const competitionScoresApi = createCompetitionScoresApi(ENV.VITE_SERVER_URL);
