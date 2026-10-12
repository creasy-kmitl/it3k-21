import type { CalendarStatus } from "@it3k/db/calendar-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { CalendarRoutes } from "../../../server/src/routes/calendar";
import { ENV } from "../env.public";
import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<CalendarRoutes>>;
type Item = Client["items"][":id"];

export type CalendarPage = InferResponseType<Client["items"]["$get"], 200>;
export type CalendarItem = CalendarPage["items"][number];
export type CalendarItemDetail = InferResponseType<Item["$get"], 200>;
export type CalendarChange = CalendarItemDetail["changes"][number];
export type CalendarPerson = InferResponseType<Client["people"]["$get"], 200>["items"][number];
export type CalendarInput = InferRequestType<Client["items"]["$post"]>["json"];
export type CalendarUpdate = InferRequestType<Item["$patch"]>["json"];
export type CalendarInbox = InferResponseType<Client["notifications"]["$get"], 200>;
export type CalendarNotification = CalendarInbox["items"][number];

export type CalendarFilters = {
  /** Omitted or empty means every department. */
  departmentIds?: string[];
  statuses?: CalendarStatus[];
  ownerId?: string;
  q?: string;
};

export type CalendarQuery = CalendarFilters & { from: number; to: number };

type ListQuery = InferRequestType<Client["items"]["$get"]>["query"];

/** Drops blank filters so the URL only carries what the user asked for. */
function query(params: CalendarQuery): ListQuery {
  const list = (values: string[] | undefined) => (values?.length ? values.join(",") : undefined);
  const entries: ListQuery = {
    from: String(params.from),
    to: String(params.to),
    departmentIds: list(params.departmentIds),
    status: list(params.statuses),
    ownerId: params.ownerId || undefined,
    q: params.q?.trim() || undefined,
  };
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as ListQuery;
}

export function createCalendarApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<CalendarRoutes>(`${baseUrl}/api/calendar`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list(params: CalendarQuery) {
      const res = await client.items.$get({ query: query(params) });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async get(id: string) {
      const res = await client.items[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async people(q?: string) {
      const res = await client.people.$get({ query: q?.trim() ? { q: q.trim() } : {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async create(json: CalendarInput) {
      const res = await client.items.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async update(id: string, json: CalendarUpdate) {
      const res = await client.items[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async remove(id: string, version: number) {
      const res = await client.items[":id"].$delete({
        param: { id },
        query: { version: String(version) },
      });
      if (!res.ok) throw await toApiError(res);
    },

    /** One page of the inbox, newest first; pass `nextCursor` for the next, older one. */
    async notifications(cursor?: string) {
      const res = await client.notifications.$get({ query: cursor ? { cursor } : {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async markRead(ids: string[] | "all") {
      const res = await client.notifications.read.$post({
        json: ids === "all" ? { all: true } : { ids },
      });
      if (!res.ok) throw await toApiError(res);
    },
  };
}

export type CalendarApi = ReturnType<typeof createCalendarApi>;

export const calendarApi = createCalendarApi(ENV.VITE_SERVER_URL);
