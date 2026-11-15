import { createFileRoute } from "@tanstack/react-router";

import { ScoresPage } from "@/components/scores/scores-page";

export const Route = createFileRoute("/staff/scores")({
  component: ScoresPage,
});
