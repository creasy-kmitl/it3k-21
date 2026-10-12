import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import Loader from "./components/loader";
import NotFound from "./components/not-found";
import RouteError from "./components/route-error";
import { isSignedOut } from "./lib/leadership";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // One client per router, so server renders never share cached data.
  // A 401 on a staff page means the session ended while the page was open:
  // sign in again and come back, rather than leaving a "failed to load" behind.
  const onError = (error: Error) => {
    if (!isSignedOut(error)) return;
    const { pathname, href } = router.state.location;
    if (!pathname.startsWith("/staff")) return;
    void router.navigate({ to: "/login", search: { to: href } });
  };
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  });

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: { queryClient },
    defaultPendingComponent: () => <Loader />,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
