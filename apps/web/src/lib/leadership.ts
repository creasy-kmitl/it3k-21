import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { LeadershipRoutes } from "../../../server/src/routes/leadership";
import { ENV } from "../env.public";

/** A non-2xx API response, carrying the server's readable `message`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The parsed error body, for responses that say more than `message`. */
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function toApiError(res: { status: number; json(): Promise<unknown> }) {
  const body: unknown = await res.json().catch(() => null);
  const message =
    body && typeof body === "object" && "message" in body && typeof body.message === "string"
      ? body.message
      : `Request failed (${res.status})`;
  return new ApiError(res.status, message, body);
}

type Client = ReturnType<typeof hc<LeadershipRoutes>>;
type Seat = Client[":id"];

export type LeadershipPage = InferResponseType<Client["index"]["$get"], 200>;
export type LeadershipSummary = LeadershipPage["items"][number];
export type LeadershipInput = InferRequestType<Client["index"]["$post"]>["json"];
export type LeadershipUpdate = InferRequestType<Seat["$patch"]>["json"];
export type LeadershipContact = InferResponseType<Seat["reveal"]["$post"], 200>;
export type LeadershipDepartment = InferResponseType<Client["departments"]["$get"], 200>[number];
export type AttachableUser = InferResponseType<Client["users"]["$get"], 200>["items"][number];

export type ListQuery = { q?: string; departmentId?: string; page: number };

/** Drops blank filters so the URL only carries what the user asked for. */
function query(params: ListQuery) {
  return {
    page: String(params.page),
    ...(params.q?.trim() ? { q: params.q.trim() } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
  };
}

export function createLeadershipApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<LeadershipRoutes>(`${baseUrl}/api/leadership`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list(params: ListQuery) {
      const res = await client.index.$get({ query: query(params) });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async get(id: string) {
      const res = await client[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async departments() {
      const res = await client.departments.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async users(params: ListQuery) {
      const res = await client.users.$get({ query: query(params) });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async create(json: LeadershipInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async update(id: string, json: LeadershipUpdate) {
      const res = await client[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async remove(id: string): Promise<void> {
      const res = await client[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
    },

    /** Contact details; the server audits every call. Never cache the result. */
    async reveal(id: string) {
      const res = await client[":id"].reveal.$post({ param: { id }, json: { confirmed: true } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type LeadershipApi = ReturnType<typeof createLeadershipApi>;

export const leadershipApi = createLeadershipApi(ENV.VITE_SERVER_URL);
