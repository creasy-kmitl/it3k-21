import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export type SessionObserver = {
  useSession: () => {
    isPending: boolean;
    data: { user: { id: string } } | null;
  };
};

const EndSessionContext = createContext<(() => void) | null>(null);
export function useEndSession() {
  return use(EndSessionContext);
}

/** Hide private state immediately when the observed session no longer owns it. */
export function SessionBoundary({
  userId,
  children,
  client = authClient,
}: {
  userId: string;
  children: ReactNode;
  client?: SessionObserver;
}) {
  const { data: session, isPending } = client.useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [ended, setEnded] = useState(false);
  const endSession = useCallback(() => setEnded(true), []);
  const currentId = session?.user.id ?? null;
  const changed = ended || (currentId !== userId && (!isPending || currentId !== null));
  useEffect(() => {
    if (!changed) return;
    queryClient.clear();
    const { pathname, href } = router.state.location;
    // A deliberate sign-out may already have left the protected page.
    if (pathname !== "/signup" && pathname !== "/me" && !pathname.startsWith("/staff")) return;
    void router.navigate({
      to: "/login",
      search: { to: href },
      replace: true,
      ignoreBlocker: true,
    });
  }, [changed, currentId, queryClient, router]);
  // Unmounting also stops pending autosaves and aborts active file uploads.
  return !ended && currentId === userId ? (
    <EndSessionContext value={endSession}>{children}</EndSessionContext>
  ) : null;
}
