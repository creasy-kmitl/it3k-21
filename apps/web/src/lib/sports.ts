import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";
import type { DivisionInput, SportInput } from "@it3k/db/sport-rules";

import type { SportRoutes } from "../../../server/src/routes/sports";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<SportRoutes>>;

export type SportList = InferResponseType<Client["index"]["$get"], 200>;
export type Sport = SportList["items"][number];
export type Division = Sport["divisions"][number];

export function createSportsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<SportRoutes>(`${baseUrl}/api/sports`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async create(json: SportInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async update(id: string, json: Partial<SportInput>) {
      const res = await client[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async remove(id: string) {
      const res = await client[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async createDivision(sportId: string, json: DivisionInput) {
      const res = await client[":id"].divisions.$post({ param: { id: sportId }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async updateDivision(id: string, json: Partial<DivisionInput>) {
      const res = await client.divisions[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async removeDivision(id: string) {
      const res = await client.divisions[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type SportsApi = ReturnType<typeof createSportsApi>;

export const sportsApi = createSportsApi(ENV.VITE_SERVER_URL);
