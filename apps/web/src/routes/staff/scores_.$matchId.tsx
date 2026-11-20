import { createFileRoute } from "@tanstack/react-router";

import { MatchControlPage } from "@/components/scores/match-control-page";

export const Route = createFileRoute("/staff/scores_/$matchId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { matchId } = Route.useParams();
  return <MatchControlPage matchId={matchId} />;
}
