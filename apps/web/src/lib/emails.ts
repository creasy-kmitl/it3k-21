import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { EmailRoutes } from "../../../server/src/routes/emails";
import { ENV } from "../env.public";
import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<EmailRoutes>>;

export type EmailAudiences = InferResponseType<Client["audiences"]["$get"], 200>;
export type EmailRecipient = InferResponseType<Client["recipients"]["$get"], 200>["items"][number];
export type EmailCampaign = InferResponseType<Client["index"]["$get"], 200>["items"][number];
export type ComposeEmail = InferRequestType<Client["index"]["$post"]>["json"];
export type EmailPreview = InferResponseType<Client["preview"]["$post"], 200>;

export const EMAILS_KEY = ["emails"] as const;

export function createEmailsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<EmailRoutes>(`${baseUrl}/api/emails`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async audiences() {
      const res = await client.audiences.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async recipients(q: string) {
      const res = await client.recipients.$get({ query: { q } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async preview(json: ComposeEmail) {
      const res = await client.preview.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async send(json: ComposeEmail) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async history() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type EmailsApi = ReturnType<typeof createEmailsApi>;

export const emailsApi = createEmailsApi(ENV.VITE_SERVER_URL);
