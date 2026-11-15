import type { CheckinMethod, EventInput, EventType } from "@it3k/db/event-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { EventRoutes } from "../../../server/src/routes/events";
import { ENV } from "../env.public";

import { ApiError, toApiError } from "./leadership";

type Client = ReturnType<typeof hc<EventRoutes>>;

export type EventList = InferResponseType<Client["index"]["$get"], 200>;
export type EventItem = EventList["items"][number];
export type EventFilters = { type?: EventType; endsAfter?: number };
export type ParticipantList = InferResponseType<Client[":id"]["participants"]["$get"], 200>;
export type Participant = ParticipantList["items"][number];
export type Person = Omit<Participant, "expected" | "checkin">;

/** What the kiosk shows after a scan. */
export type CheckinOutcome =
  | { code: "checked-in"; person: Person; checkedInAt: string; forced: boolean }
  | { code: "duplicate"; person: Person; checkedInAt: string; message: string }
  | { code: "not-listed"; person: Person; canForce: boolean; message: string }
  | { code: "unknown"; message: string };

const OUTCOME_CODES = new Set(["checked-in", "duplicate", "not-listed", "unknown"]);
const isOutcome = (body: unknown): body is CheckinOutcome =>
  !!body &&
  typeof body === "object" &&
  "code" in body &&
  typeof body.code === "string" &&
  OUTCOME_CODES.has(body.code);

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
    async participants(id: string) {
      const res = await client[":id"].participants.$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    /** A refused scan is an outcome to show, not an error; only failures throw. */
    async checkIn(
      id: string,
      json: { userId: string; method: CheckinMethod; force?: boolean },
    ): Promise<CheckinOutcome> {
      const res = await client[":id"].checkins.$post({ param: { id }, json });
      const body: unknown = await res.json().catch(() => null);
      if (isOutcome(body)) return body;
      const message =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : `Request failed (${res.status})`;
      throw new ApiError(res.status, message, body);
    },
    async undoCheckIn(id: string, userId: string) {
      const res = await client[":id"].checkins[":userId"].$delete({ param: { id, userId } });
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
