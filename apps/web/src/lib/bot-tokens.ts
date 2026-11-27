import type { BotTokenInput } from "@it3k/db/bot-token-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { BotTokenRoutes } from "../../../server/src/routes/bot-tokens";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<BotTokenRoutes>>;

export type BotToken = InferResponseType<Client["index"]["$get"], 200>["items"][number];
/** A token just issued: the only response that carries the plain `token`. */
export type IssuedBotToken = InferResponseType<Client["index"]["$post"], 201>;

export function createBotTokensApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<BotTokenRoutes>(`${baseUrl}/api/bot-tokens`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async issue(json: BotTokenInput) {
      const res = await client.index.$post({ json });
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

export type BotTokensApi = ReturnType<typeof createBotTokensApi>;

export const botTokensApi = createBotTokensApi(ENV.VITE_SERVER_URL);
