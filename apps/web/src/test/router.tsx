// Test-only: renders a component inside a memory router so <Link> works.
import { act, render } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from "@tanstack/react-router";

export async function renderAtRoot(Component: RouteComponent) {
  const root = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: Component }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>login page</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(() => router.load());
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}
