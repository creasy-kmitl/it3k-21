// Test-only: renders a component inside a memory router so <Link> works.
import { act, render } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRoute,
  type RouteComponent,
} from "@tanstack/react-router";

export async function renderAtRoot(Component: RouteComponent, path = "/") {
  const root = createRootRoute({ component: Outlet });
  const routes: AnyRoute[] = [
    createRoute({ getParentRoute: () => root, path, component: Component }),
    createRoute({ getParentRoute: () => root, path: "/login", component: () => <p>login page</p> }),
  ];
  if (path !== "/")
    routes.push(
      createRoute({ getParentRoute: () => root, path: "/", component: () => <p>home page</p> }),
    );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(() => router.load());
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}
