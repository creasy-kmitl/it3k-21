// Test-only: renders UI with a fresh, non-retrying QueryClient, plus a fake
// leadership API whose methods fail loudly unless a test provides them.
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { LeadershipApi, LeadershipPage, LeadershipSummary } from "@/lib/leadership";

export function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
}

function unexpected(name: string) {
  return () => Promise.reject(new Error(`Unexpected call to ${name}`));
}

export function fakeApi(overrides: Partial<LeadershipApi> = {}): LeadershipApi {
  return {
    list: unexpected("list"),
    get: unexpected("get"),
    departments: async () => [
      { id: "d-art", name: "Art" },
      { id: "d-tech", name: "Tech/Live" },
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
