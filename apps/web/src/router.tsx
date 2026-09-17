import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import Loader from "./components/loader";
import NotFound from "./components/not-found";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    context: {},
    defaultPendingComponent: () => <Loader />,
    defaultNotFoundComponent: NotFound,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
