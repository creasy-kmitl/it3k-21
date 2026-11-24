// The teams stream (B1) fills this client in.
import type { ClientRequestOptions, hc } from "hono/client";

import type { CompetitionTeamRoutes } from "../../../server/src/routes/competition-teams";
import { ENV } from "../env.public";

/** The typed client the methods call: hc<CompetitionTeamRoutes>(`${baseUrl}/api/competition/teams`, { credentials: "include" }). */
export type Client = ReturnType<typeof hc<CompetitionTeamRoutes>>;

export function createCompetitionTeamsApi(
  _baseUrl: string,
  _fetchImpl?: ClientRequestOptions["fetch"],
) {
  return {};
}

export type CompetitionTeamsApi = ReturnType<typeof createCompetitionTeamsApi>;

export const competitionTeamsApi = createCompetitionTeamsApi(ENV.VITE_SERVER_URL);
