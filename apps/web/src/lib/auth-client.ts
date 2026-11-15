import { ac, roles } from "@it3k/auth/permissions";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ENV } from "../env.public";
import { ApiError } from "./leadership";

export const authClient = createAuthClient({
  baseURL: ENV.VITE_SERVER_URL,
  plugins: [
    adminClient({ ac, roles }),
    inferAdditionalFields({
      user: {
        departmentId: { type: "string", required: false, input: false },
      },
    }),
  ],
});

/**
 * Reads the session like `authClient.getSession()`, but throws when the API
 * itself failed. Without this, a 5xx comes back as "no session" and a server
 * outage would send people to the sign-in page. A 401 still means signed out.
 */
export async function getSessionOrThrow() {
  const session = await authClient.getSession();
  const { error } = session;
  if (error && error.status !== 401) {
    throw new ApiError(
      error.status,
      error.message || error.statusText || `Request failed (${error.status})`,
    );
  }
  return session;
}
