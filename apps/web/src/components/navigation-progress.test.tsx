import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { NavigationProgress } from "./navigation-progress";

afterEach(cleanup);

describe("NavigationProgress", () => {
  test("shows while the next page loads and hides once it has", async () => {
    let release = () => {};
    const root = createRootRoute({
      component: () => (
        <>
          <NavigationProgress />
          <Outlet />
        </>
      ),
    });
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: "/", component: () => <p>home</p> }),
        createRoute({
          getParentRoute: () => root,
          path: "/slow",
          loader: () => new Promise<void>((resolve) => (release = resolve)),
          component: () => <p>slow page</p>,
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await act(() => router.load());
    const view = render(<RouterProvider router={router} />);
    await view.findByText("home");
    const bar = view.getByRole("progressbar", { hidden: true });
    expect(bar.dataset.loading).toBe("false");

    // Through history: `navigate` is typed to the app's registered routes.
    act(() => router.history.push("/slow"));
    await waitFor(() => expect(bar.dataset.loading).toBe("true"));
    // The page being left stays up while the next one loads.
    expect(view.getByText("home")).toBeTruthy();

    act(() => release());
    await view.findByText("slow page");
    await waitFor(() => expect(bar.dataset.loading).toBe("false"));
  });
});
