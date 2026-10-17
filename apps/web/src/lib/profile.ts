import type { ProfileValues } from "@it3k/db/profile";
import {
  hc,
  type ClientRequestOptions,
  type InferRequestType,
  type InferResponseType,
} from "hono/client";
import type { ProfileRoutes } from "../../../server/src/routes/profile";
import { ENV } from "../env.public";
import { ApiError, toApiError } from "./leadership";
import { authClient } from "./auth-client";

type Client = ReturnType<typeof hc<ProfileRoutes>>;
export type MyProfile = InferResponseType<Client["me"]["$get"], 200>;
export function createProfileApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<ProfileRoutes>(`${baseUrl}/api/profile`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });
  return {
    async me(expectedUserId?: string) {
      const res = await client.me.$get();
      if (!res.ok) throw await toApiError(res);
      const data = await res.json();
      if (expectedUserId && data.account.id !== expectedUserId) {
        authClient.$store.notify("$sessionSignal");
        throw new ApiError(401, "บัญชีที่เข้าสู่ระบบเปลี่ยนแปลงแล้ว");
      }
      return data;
    },
    async saveDraft(revision: number, values: ProfileValues, userId: string) {
      const res = await client.draft.$put({ json: { revision, values, userId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async submit(json: InferRequestType<Client["submit"]["$post"]>["json"]) {
      const res = await client.submit.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}
export type ProfileApi = ReturnType<typeof createProfileApi>;
export const profileApi = createProfileApi(ENV.VITE_SERVER_URL);
