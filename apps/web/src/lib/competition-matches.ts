// The matches stream (B2) fills this client in.
import type { ClientRequestOptions, hc } from "hono/client";

import type { CompetitionMatchRoutes } from "../../../server/src/routes/competition-matches";
import { ENV } from "../env.public";

/** The typed client the methods call: hc<CompetitionMatchRoutes>(`${baseUrl}/api/competition/matches`, { credentials: "include" }). */
export type Client = ReturnType<typeof hc<CompetitionMatchRoutes>>;

export function createCompetitionMatchesApi(
  _baseUrl: string,
  _fetchImpl?: ClientRequestOptions["fetch"],
) {
  return {};
}

export type CompetitionMatchesApi = ReturnType<typeof createCompetitionMatchesApi>;

export const competitionMatchesApi = createCompetitionMatchesApi(ENV.VITE_SERVER_URL);
