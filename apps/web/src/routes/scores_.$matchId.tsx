import { createFileRoute } from "@tanstack/react-router";

import { PublicMatchPage } from "@/components/scores/public-match-page";

export const Route = createFileRoute("/scores_/$matchId")({
  // Scores change during the event; render in the browser and poll from there.
  ssr: false,
  component: RouteComponent,
});

function RouteComponent() {
  const { matchId } = Route.useParams();
  return <PublicMatchPage matchId={matchId} />;
}
