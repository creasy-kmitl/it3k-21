import type { EventInput, EventType } from "@it3k/db/event-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { EventRoutes } from "../../../server/src/routes/events";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<EventRoutes>>;

export type EventList = InferResponseType<Client["index"]["$get"], 200>;
export type EventItem = EventList["items"][number];
export type EventFilters = { type?: EventType; endsAfter?: number };

export function createEventsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<EventRoutes>(`${baseUrl}/api/events`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list(filters: EventFilters = {}) {
      const res = await client.index.$get({
        query: {
          ...(filters.type ? { type: filters.type } : {}),
          ...(filters.endsAfter === undefined ? {} : { endsAfter: String(filters.endsAfter) }),
        },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async get(id: string) {
      const res = await client[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async create(json: EventInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async update(id: string, json: EventInput & { version: number }) {
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

export type EventsApi = ReturnType<typeof createEventsApi>;

export const eventsApi = createEventsApi(ENV.VITE_SERVER_URL);
