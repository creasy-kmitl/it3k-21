import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { InvitationRoutes } from "../../../server/src/routes/invitations";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<InvitationRoutes>>;

export type InvitationList = InferResponseType<Client["index"]["$get"], 200>;
export type Invitation = InvitationList["items"][number];
export type NewInvitation = InferRequestType<Client["index"]["$post"]>["json"];

export function createInvitationsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<InvitationRoutes>(`${baseUrl}/api/invitations`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async create(json: NewInvitation) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async resend(id: string) {
      const res = await client[":id"].resend.$post({ param: { id }, json: {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async revoke(id: string) {
      const res = await client[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type InvitationsApi = ReturnType<typeof createInvitationsApi>;

export const invitationsApi = createInvitationsApi(ENV.VITE_SERVER_URL);
