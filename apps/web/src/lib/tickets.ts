import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { TicketRoutes } from "../../../server/src/routes/tickets";
import { ENV } from "../env.public";

import { ApiError, toApiError } from "./leadership";

type Client = ReturnType<typeof hc<TicketRoutes>>;

export type TicketList = InferResponseType<Client["index"]["$get"], 200>;
export type Ticket = TicketList["items"][number];
export type OpenEventList = InferResponseType<Client["events"]["$get"], 200>;
export type OpenEvent = OpenEventList["items"][number];
export type EventDetail = InferResponseType<Client["events"][":id"]["$get"], 200>;

/** Every ticket query lives under this key, so a claim or cancel refreshes them all. */
export const TICKETS_KEY = ["tickets"] as const;

/** Why a claim was refused, as the API reports it. */
export type ClaimRefusal = "closed" | "full" | "not-listed" | "missing";

export function claimRefusal(error: unknown): ClaimRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (body && typeof body === "object" && "code" in body && typeof body.code === "string") {
    return ["closed", "full", "not-listed", "missing"].includes(body.code)
      ? (body.code as ClaimRefusal)
      : null;
  }
  return null;
}

export function createTicketsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<TicketRoutes>(`${baseUrl}/api/tickets`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async mine() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async openEvents() {
      const res = await client.events.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async event(eventId: string) {
      const res = await client.events[":id"].$get({ param: { id: eventId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async claim(eventId: string) {
      const res = await client.events[":id"].$post({ param: { id: eventId }, json: {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async cancel(ticketId: string) {
      const res = await client[":ticketId"].$delete({ param: { ticketId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type TicketsApi = ReturnType<typeof createTicketsApi>;

export const ticketsApi = createTicketsApi(ENV.VITE_SERVER_URL);
