// The check-in stream (B4) fills this client in.
import type { ClientRequestOptions, hc } from "hono/client";

import type { CompetitionCheckinRoutes } from "../../../server/src/routes/competition-checkins";
import { ENV } from "../env.public";

/** The typed client the methods call: hc<CompetitionCheckinRoutes>(`${baseUrl}/api/competition/checkins`, { credentials: "include" }). */
export type Client = ReturnType<typeof hc<CompetitionCheckinRoutes>>;

export function createCompetitionCheckinsApi(
  _baseUrl: string,
  _fetchImpl?: ClientRequestOptions["fetch"],
) {
  return {};
}

export type CompetitionCheckinsApi = ReturnType<typeof createCompetitionCheckinsApi>;

export const competitionCheckinsApi = createCompetitionCheckinsApi(ENV.VITE_SERVER_URL);
