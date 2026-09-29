import { createFileRoute } from "@tanstack/react-router";

import LeadershipManager from "@/components/leadership-manager";

export const Route = createFileRoute("/_auth/head")({
  component: LeadershipManager,
});
