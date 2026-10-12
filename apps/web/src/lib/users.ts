import { useQuery } from "@tanstack/react-query";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { UserRoutes } from "../../../server/src/routes/users";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<UserRoutes>>;

export type Me = InferResponseType<Client["me"]["$get"], 200>;
export type AccountPage = InferResponseType<Client["index"]["$get"], 200>;
export type Account = AccountPage["items"][number];
export type Assignment = InferRequestType<Client[":id"]["assignment"]["$put"]>["json"];
export type AccountQuery = { q?: string; departmentId?: string; page: number };

export function createUsersApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<UserRoutes>(`${baseUrl}/api/users`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async me() {
      const res = await client.me.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async list({ q, departmentId, page }: AccountQuery) {
      const res = await client.index.$get({
        query: {
          page: String(page),
          ...(q?.trim() ? { q: q.trim() } : {}),
          ...(departmentId ? { departmentId } : {}),
        },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async assign(id: string, json: Assignment) {
      const res = await client[":id"].assignment.$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async setAdmin(id: string, admin: boolean) {
      const res = await client[":id"].admin.$put({ param: { id }, json: { admin } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type UsersApi = ReturnType<typeof createUsersApi>;

export const usersApi = createUsersApi(ENV.VITE_SERVER_URL);

/** The signed-in account's role, department and seat, fresh from the server. */
export function useMe(api: UsersApi = usersApi) {
  return useQuery({
    queryKey: ["users", "me"],
    queryFn: () => api.me(),
    staleTime: 60_000,
  });
}
