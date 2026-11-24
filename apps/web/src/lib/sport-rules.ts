import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";
import type { RulesInput } from "@it3k/db/sport-rules";

import type { SportRuleRoutes } from "../../../server/src/routes/sport-rules";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<SportRuleRoutes>>;

export type SportRulesPage = InferResponseType<Client["sports"][":id"]["$get"], 200>;
export type DivisionRulesPage = InferResponseType<Client["divisions"][":id"]["$get"], 200>;
export type SavedRules = NonNullable<SportRulesPage["rules"]>;

export function createSportRulesApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<SportRuleRoutes>(`${baseUrl}/api/sport-rules`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async sport(id: string) {
      const res = await client.sports[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async division(id: string) {
      const res = await client.divisions[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async saveSport(id: string, json: RulesInput) {
      const res = await client.sports[":id"].$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async saveDivision(id: string, json: RulesInput) {
      const res = await client.divisions[":id"].$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type SportRulesApi = ReturnType<typeof createSportRulesApi>;

export const sportRulesApi = createSportRulesApi(ENV.VITE_SERVER_URL);
