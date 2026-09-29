// Test-only: renders UI with a fresh, non-retrying QueryClient, plus a fake
// leadership API whose methods fail loudly unless a test provides them.
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouteComponent } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ApiProvider, type Apis } from "@/lib/api-context";
import type { LeadershipApi, LeadershipPage, LeadershipSummary } from "@/lib/leadership";
import type { UsersApi } from "@/lib/users";

export function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
}

/** Opens a select from its trigger and picks the option with this label. */
export async function choose(trigger: HTMLElement, option: string) {
  fireEvent.click(trigger);
  const item = await screen.findByRole("option", { name: option });
  // Base UI ignores mouse clicks that did not start on the item.
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.click(item);
}

function unexpected(name: string) {
  return () => Promise.reject(new Error(`Unexpected call to ${name}`));
}

export function fakeUsersApi(overrides: Partial<UsersApi> = {}): UsersApi {
  return {
    me: unexpected("me"),
    list: unexpected("list"),
    assign: unexpected("assign"),
    setAdmin: unexpected("setAdmin"),
    ...overrides,
  };
}

/** Renders a file route's page with fake API clients in place of the real ones. */
export function renderRoute(
  route: { options: { component?: RouteComponent } },
  apis: Partial<Apis> = {},
) {
  const Page = route.options.component;
  if (!Page) throw new Error("Route has no component");
  return renderWithQuery(
    <ApiProvider
      value={{ leadership: apis.leadership ?? fakeApi(), users: apis.users ?? fakeUsersApi() }}
    >
      <Page />
    </ApiProvider>,
  );
}

export function fakeApi(overrides: Partial<LeadershipApi> = {}): LeadershipApi {
  return {
    list: unexpected("list"),
    get: unexpected("get"),
    departments: async () => [
      { id: "d-art", name: "Art", icon: "palette", color: "rose" },
      { id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" },
    ],
    users: unexpected("users"),
    create: unexpected("create"),
    update: unexpected("update"),
    remove: unexpected("remove"),
    reveal: unexpected("reveal"),
    ...overrides,
  };
}

export function summary(overrides: Partial<LeadershipSummary> = {}): LeadershipSummary {
  return {
    id: crypto.randomUUID(),
    departmentId: "d-art",
    departmentName: "Art",
    role: "head",
    userId: null,
    name: "Arthit",
    nickname: null,
    displayName: "Arthit",
    canEdit: false,
    canDelete: false,
    ...overrides,
  };
}

export function page(items: LeadershipSummary[], overrides: Partial<LeadershipPage> = {}) {
  return { items, page: 1, hasMore: false, canCreate: false, ...overrides };
}
