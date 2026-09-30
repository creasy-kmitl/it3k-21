import type { CalendarCategory, CalendarMode, CalendarStatus, Game } from "@it3k/db/calendar-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { CalendarRoutes } from "../../../server/src/routes/calendar";
import { ENV } from "../env.public";
import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<CalendarRoutes>>;
type Item = Client["items"][":id"];
type Link = Item["departments"][":departmentId"];
type Action = Client["action-items"][":id"];

export type CalendarPage = InferResponseType<Client["items"]["$get"], 200>;
export type CalendarItem = CalendarPage["items"][number];
export type CalendarItemDetail = InferResponseType<Item["$get"], 200>;
export type CalendarChange = CalendarItemDetail["changes"][number];
export type CalendarPerson = InferResponseType<Client["people"]["$get"], 200>["items"][number];
export type CalendarInput = InferRequestType<Client["items"]["$post"]>["json"];
export type CalendarUpdate = InferRequestType<Item["$patch"]>["json"];
export type CalendarDepartmentLink = CalendarItemDetail["departments"][number];
export type CalendarActionItem = CalendarItemDetail["actionItems"][number];
export type CalendarDecision = CalendarItemDetail["decisions"][number];
export type CalendarRequestInput = InferRequestType<Link["request"]["$put"]>["json"];
export type CalendarActionInput = InferRequestType<Item["action-items"]["$post"]>["json"];
export type CalendarActionUpdate = InferRequestType<Action["$patch"]>["json"];
export type CalendarDependencyLink = CalendarItemDetail["dependsOn"][number];
export type CalendarSearchResult = InferResponseType<
  Client["search"]["$get"],
  200
>["items"][number];
export type CalendarInbox = InferResponseType<Client["notifications"]["$get"], 200>;
export type CalendarNotification = CalendarInbox["items"][number];
export type CalendarAttention = CalendarInbox["attention"][number];
export type CalendarChecklistEntry = NonNullable<CalendarItemDetail["checklist"]>[number];
export type CalendarChecklistInput = InferRequestType<Item["checklist"][":key"]["$put"]>["json"];

/** An overlapping item the API says a save would clash with (a 422 body). */
export type CalendarConflict = {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  kinds: ("person" | "venue" | "stream" | "release_window")[];
  people: string[];
};

/** The clashes in a refused save, or null when the error is something else. */
export function conflictsOf(body: unknown): CalendarConflict[] | null {
  if (!body || typeof body !== "object" || !("conflicts" in body)) return null;
  const conflicts = (body as { conflicts: unknown }).conflicts;
  return Array.isArray(conflicts) ? (conflicts as CalendarConflict[]) : null;
}

export type CalendarFilters = {
  modes?: CalendarMode[];
  categories?: CalendarCategory[];
  statuses?: CalendarStatus[];
  ownerId?: string;
  departmentId?: string;
  game?: Game;
  venue?: string;
  streamPlatform?: string;
  environment?: string;
  q?: string;
  includeArchived?: boolean;
};

export type CalendarQuery = CalendarFilters & { from: number; to: number };

type ListQuery = InferRequestType<Client["items"]["$get"]>["query"];

/** Drops blank filters so the URL only carries what the user asked for. */
function query(params: CalendarQuery): ListQuery {
  const text = (value: string | undefined) => value?.trim() || undefined;
  const list = (values: string[] | undefined) => (values?.length ? values.join(",") : undefined);
  const entries: ListQuery = {
    from: String(params.from),
    to: String(params.to),
    mode: list(params.modes),
    category: list(params.categories),
    status: list(params.statuses),
    ownerId: params.ownerId || undefined,
    departmentId: params.departmentId || undefined,
    game: params.game,
    venue: text(params.venue),
    streamPlatform: text(params.streamPlatform),
    environment: text(params.environment),
    q: text(params.q),
    includeArchived: params.includeArchived ? "true" : undefined,
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

    async duplicate(id: string) {
      const res = await client.items[":id"].duplicate.$post({ param: { id }, json: {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async request(id: string, departmentId: string, json: CalendarRequestInput) {
      const res = await client.items[":id"].departments[":departmentId"].request.$put({
        param: { id, departmentId },
        json,
      });
      if (!res.ok) throw await toApiError(res);
    },

    async answer(id: string, departmentId: string, response: string) {
      const res = await client.items[":id"].departments[":departmentId"].answer.$post({
        param: { id, departmentId },
        json: { response },
      });
      if (!res.ok) throw await toApiError(res);
    },

    async check(id: string, key: CalendarChecklistEntry["key"], json: CalendarChecklistInput) {
      const res = await client.items[":id"].checklist[":key"].$put({
        param: { id, key },
        json,
      });
      if (!res.ok) throw await toApiError(res);
    },

    async search(q: string) {
      const res = await client.search.$get({ query: { q } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async addDependency(id: string, dependsOnId: string, impact: string | null) {
      const res = await client.items[":id"].dependencies.$post({
        param: { id },
        json: { dependsOnId, impact },
      });
      if (!res.ok) throw await toApiError(res);
    },

    async removeDependency(id: string) {
      const res = await client.dependencies[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
    },

    async notifications() {
      const res = await client.notifications.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async markRead(ids: string[] | "all") {
      const res = await client.notifications.read.$post({
        json: ids === "all" ? { all: true } : { ids },
      });
      if (!res.ok) throw await toApiError(res);
    },

    async myActionItems() {
      const res = await client["action-items"].$get({ query: {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async addActionItem(id: string, json: CalendarActionInput) {
      const res = await client.items[":id"]["action-items"].$post({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async updateActionItem(id: string, json: CalendarActionUpdate) {
      const res = await client["action-items"][":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
    },

    async removeActionItem(id: string) {
      const res = await client["action-items"][":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
    },

    async addDecision(id: string, text: string) {
      const res = await client.items[":id"].decisions.$post({ param: { id }, json: { text } });
      if (!res.ok) throw await toApiError(res);
    },

    async removeDecision(id: string) {
      const res = await client.decisions[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
    },
  };
}

export type CalendarApi = ReturnType<typeof createCalendarApi>;

export const calendarApi = createCalendarApi(ENV.VITE_SERVER_URL);
