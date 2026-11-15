import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { getSessionOrThrow } from "./auth-client";
import { clearCacheOnUserChange } from "./query-cache";

export async function requireParticipantSession(queryClient: QueryClient, href: string) {
  const session = await getSessionOrThrow();
  clearCacheOnUserChange(queryClient, session.data?.user.id ?? null);
  if (!session.data) throw redirect({ to: "/login", search: { to: href } });
  return session.data;
}
