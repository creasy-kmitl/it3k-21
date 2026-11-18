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
export type OpenTicketType = OpenEvent["ticketTypes"][number];
export type HeldTickets = InferResponseType<Client["events"][":id"]["ticket"]["$get"], 200>;

/** Where a ticket's own page lives: the event's slug, or its id when it has none. */
export const ticketRef = (event: { id: string; slug: string | null }) => event.slug ?? event.id;

/** Every ticket query lives under this key, so a claim or cancel refreshes them all. */
export const TICKETS_KEY = ["tickets"] as const;

/** Why a claim is or was refused, as the API reports it. */
export const CLAIM_REFUSALS = {
  closed: "กิจกรรมนี้ปิดรับตั๋วแล้ว",
  "type-closed": "ตั๋วประเภทนี้ปิดรับแล้ว",
  full: "ตั๋วประเภทนี้เต็มแล้ว",
  limit: "รับตั๋วประเภทนี้ครบจำนวนแล้ว",
  "not-listed": "เฉพาะนักกีฬาในรายชื่อของกิจกรรมนี้",
  "not-eligible": "ตั๋วประเภทนี้ไม่ได้เปิดให้คุณรับ",
  missing: "ไม่พบกิจกรรมหรือประเภทตั๋วนี้",
} as const;
export type ClaimRefusal = keyof typeof CLAIM_REFUSALS;

const isRefusal = (code: string): code is ClaimRefusal => code in CLAIM_REFUSALS;

export function claimRefusal(error: unknown): ClaimRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (body && typeof body === "object" && "code" in body && typeof body.code === "string") {
    return isRefusal(body.code) ? body.code : null;
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
    /** The caller's tickets to one event, QR codes included. */
    async ticketsFor(eventId: string) {
      const res = await client.events[":id"].ticket.$get({ param: { id: eventId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async claim(eventId: string, ticketTypeId: string) {
      const res = await client.events[":id"].$post({
        param: { id: eventId },
        json: { ticketTypeId },
      });
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
