import { createFileRoute } from "@tanstack/react-router";

import LeadershipDirectory from "@/components/leadership-directory";

export const Route = createFileRoute("/_auth/head")({
  component: LeadershipDirectory,
});
