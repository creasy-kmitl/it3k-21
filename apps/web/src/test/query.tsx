// Test-only: renders UI with a fresh, non-retrying QueryClient, plus a fake
// leadership API whose methods fail loudly unless a test provides them.
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouteComponent } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ApiProvider, type Apis } from "@/lib/api-context";
import type { CalendarApi, CalendarItem } from "@/lib/calendar";
import type { LeadershipApi, LeadershipPage, LeadershipSummary } from "@/lib/leadership";
import type { LinksApi, ShortLink } from "@/lib/links";
import type { UsersApi } from "@/lib/users";

/** Narrows a value a test expects to exist, failing loudly when it does not. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}

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
      value={{
        leadership: apis.leadership ?? fakeApi(),
        users: apis.users ?? fakeUsersApi(),
        calendar: apis.calendar ?? fakeCalendarApi(),
        links: apis.links ?? fakeLinksApi(),
      }}
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

export function fakeCalendarApi(overrides: Partial<CalendarApi> = {}): CalendarApi {
  return {
    list: unexpected("calendar.list"),
    get: unexpected("calendar.get"),
    people: async () => ({
      items: [{ id: "u-art", name: "Art Staff", departmentName: "Art" }],
    }),
    create: unexpected("calendar.create"),
    update: unexpected("calendar.update"),
    remove: unexpected("calendar.remove"),
    notifications: async () => ({ items: [], unread: 0, nextCursor: null }),
    markRead: unexpected("calendar.markRead"),
    ...overrides,
  };
}

// 2026-10-10 13:00 Bangkok time.
export const CALENDAR_NOW = Date.UTC(2026, 9, 10, 6);

export const ART_DEPARTMENT = { id: "d-art", name: "Art", icon: "palette", color: "rose" } as const;

export function calendarItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: crypto.randomUUID(),
    department: ART_DEPARTMENT,
    collaborators: [],
    title: "ประชุมออกแบบฉาก",
    status: "confirmed",
    startAt: CALENDAR_NOW + 60 * 60 * 1000,
    endAt: CALENDAR_NOW + 3 * 60 * 60 * 1000,
    timezone: "Asia/Bangkok",
    venue: null,
    notes: null,
    owner: { id: "u-art", name: "Art Staff" },
    version: 1,
    updatedAt: CALENDAR_NOW,
    canEdit: true,
    ...overrides,
  };
}

export function fakeLinksApi(overrides: Partial<LinksApi> = {}): LinksApi {
  return {
    list: unexpected("links.list"),
    get: unexpected("links.get"),
    create: unexpected("links.create"),
    update: unexpected("links.update"),
    ...overrides,
  };
}

export function shortLink(overrides: Partial<ShortLink> = {}): ShortLink {
  const slug = overrides.slug ?? "register";
  return {
    id: crypto.randomUUID(),
    slug,
    title: "ลงทะเบียนนักกีฬา",
    destination: "https://forms.example.com/register",
    fallbackUrl: null,
    tags: [],
    enabled: true,
    expiresAt: null,
    state: "active",
    shortUrl: `https://it3k.test/l/${slug}`,
    qrUrl: `https://it3k.test/l/${slug}?qr`,
    owner: { id: "u-art", name: "Art Staff" },
    visits: { qr: 0, link: 0 },
    version: 1,
    createdAt: CALENDAR_NOW,
    updatedAt: CALENDAR_NOW,
    canEdit: true,
    ...overrides,
  };
}
