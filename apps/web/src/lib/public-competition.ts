// Public competition pages: matches, the live board, standings and medals.
// Read signed out: no cookies, so the API can answer any origin (and the edge
// can cache one answer for everyone).
import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { PublicCompetitionRoutes } from "../../../server/src/routes/public-competition";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

/** The typed client the methods call. */
export type Client = ReturnType<typeof hc<PublicCompetitionRoutes>>;

export type MatchFilters = NonNullable<InferRequestType<Client["matches"]["$get"]>["query"]>;
export type FilterOptions = InferResponseType<Client["filters"]["$get"], 200>;
export type MatchList = InferResponseType<Client["matches"]["$get"], 200>;
export type PublicMatch = MatchList["items"][number];
export type PublicSide = PublicMatch["sides"][number];
export type MatchPage = InferResponseType<Client["matches"][":id"]["$get"], 200>;
export type MatchPageSide = MatchPage["sides"][number];
export type LiveBoard = InferResponseType<Client["live"]["$get"], 200>;
export type Standings = InferResponseType<Client["standings"]["$get"], 200>;
export type StandingsDivision = Standings["divisions"][number];
export type Medals = InferResponseType<Client["medals"]["$get"], 200>;

/** Drops empty filters, so equal filters make equal URLs (and edge cache entries). */
function cleanFilters(filters: MatchFilters): MatchFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""),
  ) as MatchFilters;
}

export function createPublicCompetitionApi(
  baseUrl: string,
  fetchImpl?: ClientRequestOptions["fetch"],
) {
  const client = hc<PublicCompetitionRoutes>(`${baseUrl}/api/public/competition`, {
    fetch: fetchImpl,
    init: { credentials: "omit" },
  });

  return {
    async filters() {
      const res = await client.filters.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async matches(filters: MatchFilters = {}) {
      const res = await client.matches.$get({ query: cleanFilters(filters) });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async match(id: string) {
      const res = await client.matches[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async live() {
      const res = await client.live.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async standings(divisionId?: string) {
      const res = await client.standings.$get({ query: divisionId ? { divisionId } : {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async medals() {
      const res = await client.medals.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type PublicCompetitionApi = ReturnType<typeof createPublicCompetitionApi>;

export const publicCompetitionApi = createPublicCompetitionApi(ENV.VITE_SERVER_URL);

/** Query keys; the whole family is public, so it never needs clearing on sign-out. */
export const PUBLIC_COMPETITION_KEY = ["public-competition"] as const;
