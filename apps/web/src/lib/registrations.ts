import type { RegistrationFields } from "@it3k/db/sport-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { RegistrationRoutes } from "../../../server/src/routes/registrations";
import { ENV } from "../env.public";

import { authClient } from "./auth-client";
import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<RegistrationRoutes>>;

export type MyRegistrations = InferResponseType<Client["me"]["$get"], 200>;
export type MyRegistration = MyRegistrations["registrations"][number];

export function createRegistrationsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<RegistrationRoutes>(`${baseUrl}/api/registrations`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async me() {
      const res = await client.me.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async register(json: RegistrationFields & { divisionId: string; studentId?: string }) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async update(id: string, json: RegistrationFields & { version: number }) {
      const res = await client[":id"].$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async withdraw(id: string, version: number) {
      const res = await client[":id"].withdraw.$post({ param: { id }, json: { version } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    /** Leaves for Discord and comes back to `returnTo` (an absolute web URL). */
    async linkDiscord(returnTo: string) {
      const { error } = await authClient.linkSocial({
        provider: "discord",
        callbackURL: returnTo,
        errorCallbackURL: returnTo,
      });
      if (error) throw new Error(error.message ?? "เชื่อม Discord ไม่สำเร็จ");
    },
    async unlinkDiscord(accountId: string) {
      const { error } = await authClient.unlinkAccount({ accountId });
      if (error) throw new Error(error.message ?? "ยกเลิกการเชื่อม Discord ไม่สำเร็จ");
    },
  };
}

export type RegistrationsApi = ReturnType<typeof createRegistrationsApi>;

export const registrationsApi = createRegistrationsApi(ENV.VITE_SERVER_URL);
