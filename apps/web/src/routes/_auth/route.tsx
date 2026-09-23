import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { clearCacheOnUserChange } from "@/lib/query-cache";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    clearCacheOnUserChange(context.queryClient, session.data?.user.id ?? null);
    if (!session.data) {
      // Explain why before sending them to sign in; the 401 page links to /login.
      throw redirect({
        to: "/unauthorized",
      });
    }
    return { session };
  },
});

function AuthLayout() {
  return <Outlet />;
}
