import type { DivisionCompetitionInput } from "@it3k/db/competition-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { CompetitionDivisionRoutes } from "../../../server/src/routes/competition-divisions";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<CompetitionDivisionRoutes>>;

export type CompetitionDivisionList = InferResponseType<Client["index"]["$get"], 200>;
export type CompetitionDivision = CompetitionDivisionList["items"][number];

export function createCompetitionDivisionsApi(
  baseUrl: string,
  fetchImpl?: ClientRequestOptions["fetch"],
) {
  const client = hc<CompetitionDivisionRoutes>(`${baseUrl}/api/competition/divisions`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async get(id: string) {
      const res = await client[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async save(id: string, json: DivisionCompetitionInput) {
      const res = await client[":id"].$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type CompetitionDivisionsApi = ReturnType<typeof createCompetitionDivisionsApi>;

export const competitionDivisionsApi = createCompetitionDivisionsApi(ENV.VITE_SERVER_URL);
