import { createFileRoute, redirect } from "@tanstack/react-router";

import { ScorerPage } from "@/components/competition/scorer/scorer-page";
import { SessionBoundary } from "@/components/session-boundary";
import { getSessionOrThrow } from "@/lib/auth-client";
import { clearCacheOnUserChange } from "@/lib/query-cache";
import { staffRedirect } from "./staff/route";

// Full-screen scorer for one match, held sideways by the court.
export const Route = createFileRoute("/score/$matchId")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await getSessionOrThrow();
    clearCacheOnUserChange(context.queryClient, session.data?.user.id ?? null);
    const away = staffRedirect(session.data?.user, location.href);
    if (away) throw redirect(away);
    return { session };
  },
  head: () => ({
    meta: [{ title: "ใส่คะแนน · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const { matchId } = Route.useParams();
  return (
    <SessionBoundary key={session.data?.user.id} userId={session.data?.user.id ?? ""}>
      <ScorerPage matchId={matchId} />
    </SessionBoundary>
  );
}
