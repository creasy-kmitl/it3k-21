import type { VenueInput } from "@it3k/db/event-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { VenueRoutes } from "../../../server/src/routes/venues";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<VenueRoutes>>;

export type VenueList = InferResponseType<Client["index"]["$get"], 200>;
export type Venue = VenueList["items"][number];

export function createVenuesApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<VenueRoutes>(`${baseUrl}/api/venues`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async create(json: VenueInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async update(id: string, json: VenueInput) {
      const res = await client[":id"].$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async remove(id: string) {
      const res = await client[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type VenuesApi = ReturnType<typeof createVenuesApi>;

export const venuesApi = createVenuesApi(ENV.VITE_SERVER_URL);
