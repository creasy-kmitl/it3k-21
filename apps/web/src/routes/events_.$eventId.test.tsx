import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { EventDetail, TicketsApi } from "@/lib/tickets";
import { fakeApis, fakeTicketsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventView } from "./events_.$eventId";

afterEach(cleanup);

const START = new Date(Date.UTC(2026, 11, 5, 2)).toISOString();
const END = new Date(Date.UTC(2026, 11, 5, 5)).toISOString();

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "e-2",
    slug: "concert",
    type: "general",
    name: "คอนเสิร์ต",
    description: "ดนตรีสดตลอดคืน",
    startAt: START,
    endAt: END,
    thumbnailUrl: null,
    sports: [],
    venue: { id: "v-1", name: "ลานกิจกรรม", externalUrl: "https://maps.example/v-1" },
    open: true,
    capacity: 100,
    remaining: 40,
    claimed: false,
    ticket: null,
    ...overrides,
  };
}

function setup(overrides: Partial<TicketsApi>, eventId = "concert") {
  const tickets = fakeTicketsApi(overrides);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ tickets })}>
        <EventView eventId={eventId} />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/events/$eventId", () => {
  test("shows the event, with its map link and seats", async () => {
    const asked: string[] = [];
    const view = await setup({
      event: async (eventId) => {
        asked.push(eventId);
        return detail();
      },
    });
    expect(await view.findByRole("heading", { name: "คอนเสิร์ต" })).toBeTruthy();
    expect(asked).toEqual(["concert"]);
    expect(view.getByText("ดนตรีสดตลอดคืน")).toBeTruthy();
    expect(view.getByRole("link", { name: "ดูแผนที่" }).getAttribute("href")).toBe(
      "https://maps.example/v-1",
    );
    expect(view.getByText("60/100")).toBeTruthy();
    expect(view.getByRole("button", { name: "กิจกรรมทั้งหมด" }).getAttribute("href")).toBe("/events");
  });

  test("claiming swaps the button for the ticket's QR", async () => {
    let held = false;
    const view = await setup({
      event: async () =>
        detail(
          held
            ? { claimed: true, ticket: { id: "t-1", code: "a".repeat(32), checkedInAt: null } }
            : {},
        ),
      claim: async () => {
        held = true;
        return {
          ticket: {
            id: "t-1",
            code: "a".repeat(32),
            claimedAt: START,
            checkedInAt: null,
            event: {
              id: "e-2",
              slug: "concert",
              type: "general",
              name: "คอนเสิร์ต",
              startAt: START,
              endAt: END,
              thumbnailUrl: null,
              sports: [],
            },
            venue: null,
          },
        };
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "รับตั๋ว" }));
    expect(await view.findByRole("img", { name: "QR ตั๋ว คอนเสิร์ต" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "รับตั๋ว" })).toBeNull();
  });

  test("a closed event says so; a full one cannot be claimed", async () => {
    const closed = await setup({ event: async () => detail({ open: false }) });
    expect(await closed.findByText("ปิดรับตั๋วแล้ว")).toBeTruthy();
    expect(closed.queryByRole("button", { name: "รับตั๋ว" })).toBeNull();
    cleanup();

    const full = await setup({ event: async () => detail({ remaining: 0 }) });
    const button = (await full.findByRole("button", { name: "ตั๋วเต็มแล้ว" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("an unknown event reads as not found", async () => {
    const view = await setup({
      event: async () => {
        throw new ApiError(404, "ไม่พบกิจกรรม", { code: "missing" });
      },
    });
    expect(await view.findByText(/ไม่พบกิจกรรมนี้/)).toBeTruthy();
  });
});
