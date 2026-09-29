import { createFileRoute, redirect } from "@tanstack/react-router";

// /staff on its own has no page; start at the dashboard.
export const Route = createFileRoute("/staff/")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/dashboard" });
  },
});
