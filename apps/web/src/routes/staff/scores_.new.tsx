import { createFileRoute } from "@tanstack/react-router";

import { NewMatchPage } from "@/components/scores/new-match-page";

export const Route = createFileRoute("/staff/scores_/new")({
  component: NewMatchPage,
});
