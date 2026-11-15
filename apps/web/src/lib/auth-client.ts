import { ac, hasRole, roles } from "@it3k/auth/permissions";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ENV } from "../env.public";
import { ApiError } from "./leadership";
import { type ViewAsState, loadViewAs, viewedUser } from "./view-as";

export const authClient = createAuthClient({
  baseURL: ENV.VITE_SERVER_URL,
  plugins: [
    adminClient({ ac, roles }),
    inferAdditionalFields({
      user: {
        departmentId: { type: "string", required: false, input: false },
        institution: { type: "string", required: false, input: false },
      },
    }),
  ],
});

/** A Better Auth client error as the ApiError the rest of the app reports. */
export function authError(error: { status: number; message?: string; statusText?: string }) {
  return new ApiError(
    error.status,
    error.message || error.statusText || `Request failed (${error.status})`,
  );
}

/**
 * Reads the session like `authClient.getSession()`, but throws when the API
 * itself failed. Without this, a 5xx comes back as "no session" and a server
 * outage would send people to the sign-in page. A 401 still means signed out.
 *
 * While an admin views the app as someone else ("view as"), the user it returns
 * carries that view's role, department and institution, so route guards and
 * menus show what that role sees. The API applies the same view on its own.
 */
export async function getSessionOrThrow() {
  const session = await authClient.getSession();
  const { error } = session;
  if (error && error.status !== 401) throw authError(error);
  return withViewAs(session);
}

type SessionResult = Awaited<ReturnType<typeof authClient.getSession>>;

/**
 * The session as an admin's "view as" shows it. Only an admin acting as
 * themselves is asked about a view; everyone else is returned untouched.
 */
export async function withViewAs<T extends Pick<SessionResult, "data">>(
  session: T,
  load: () => Promise<ViewAsState> = loadViewAs,
): Promise<T> {
  const data = session.data;
  if (!data || data.session.impersonatedBy || !hasRole(data.user.role, "admin")) return session;
  const view = await load();
  if (!view.active) return session;
  return { ...session, data: { ...data, user: viewedUser(data.user, view) } };
}
