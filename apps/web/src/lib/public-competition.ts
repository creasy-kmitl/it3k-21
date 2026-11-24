// The public stream (B5) fills this client in.
// Public pages are read signed out: no cookies, so the API can answer any origin.
import type { ClientRequestOptions, hc } from "hono/client";

import type { PublicCompetitionRoutes } from "../../../server/src/routes/public-competition";
import { ENV } from "../env.public";

/** The typed client the methods call: hc<PublicCompetitionRoutes>(`${baseUrl}/api/public/competition`, { credentials: "omit" }). */
export type Client = ReturnType<typeof hc<PublicCompetitionRoutes>>;

export function createPublicCompetitionApi(
  _baseUrl: string,
  _fetchImpl?: ClientRequestOptions["fetch"],
) {
  return {};
}

export type PublicCompetitionApi = ReturnType<typeof createPublicCompetitionApi>;

export const publicCompetitionApi = createPublicCompetitionApi(ENV.VITE_SERVER_URL);
