import { createFileRoute, redirect } from "@tanstack/react-router";
import { Construction } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";
import { SessionBoundary } from "@/components/session-boundary";
import { getSessionOrThrow } from "@/lib/auth-client";
import { clearCacheOnUserChange } from "@/lib/query-cache";
import { staffRedirect } from "./staff/route";

// Full-screen kiosk at a venue: athletes scan in for their next match there.
// Placeholder: the check-in stream (B4) builds this page.
export const Route = createFileRoute("/kiosk/matches/$venueId")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const session = await getSessionOrThrow();
    clearCacheOnUserChange(context.queryClient, session.data?.user.id ?? null);
    const away = staffRedirect(session.data?.user, location.href);
    if (away) throw redirect(away);
    return { session };
  },
  head: () => ({
    meta: [{ title: "Kiosk รายงานตัวแข่งขัน · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  return (
    <SessionBoundary key={session.data?.user.id} userId={session.data?.user.id ?? ""}>
      <main className="mx-auto flex min-h-svh w-full max-w-3xl p-4">
        <StreamPlaceholder icon={Construction} title="Kiosk รายงานตัวแข่งขัน" description="" />
      </main>
    </SessionBoundary>
  );
}
