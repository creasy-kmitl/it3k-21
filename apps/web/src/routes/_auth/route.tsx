import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async () => {
    const session = await authClient.getSession();
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
