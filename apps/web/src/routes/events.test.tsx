import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { OpenEvent, TicketsApi } from "@/lib/tickets";
import { fakeApis, fakeTicketsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventsView } from "./events";

afterEach(cleanup);

const START = new Date(Date.UTC(2026, 11, 5, 2)).toISOString();
const END = new Date(Date.UTC(2026, 11, 5, 5)).toISOString();

function openEvent(overrides: Partial<OpenEvent> = {}): OpenEvent {
  return {
    id: "e-2",
    slug: "concert",
    type: "general",
    name: "คอนเสิร์ต",
    description: "ดนตรีสด",
    startAt: START,
    endAt: END,
    thumbnailUrl: null,
    venue: { id: "v-1", name: "ลานกิจกรรม" },
    capacity: 100,
    remaining: 3,
    claimed: false,
    ...overrides,
  };
}

function setup(overrides: Partial<TicketsApi>) {
  const tickets = fakeTicketsApi(overrides);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ tickets })}>
        <EventsView />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/events", () => {
  test("lists open events, with held tickets marked", async () => {
    const view = await setup({
      openEvents: async () => ({
        items: [
          openEvent({ id: "e-1", name: "พิธีเปิด", claimed: true }),
          openEvent(),
          openEvent({ id: "e-3", name: "งานเลี้ยง", remaining: null }),
        ],
      }),
    });
    expect(await view.findByText("คอนเสิร์ต")).toBeTruthy();
    expect(view.getByText("เหลือ 3 ที่")).toBeTruthy();
    expect(view.getByText("ไม่จำกัดจำนวน")).toBeTruthy();
    expect(view.getByText("รับตั๋วแล้ว")).toBeTruthy();
    expect(view.getByRole("button", { name: "ดูตั๋ว" }).getAttribute("href")).toBe("/me/tickets");
    expect(view.getAllByRole("button", { name: "รับตั๋ว" })).toHaveLength(2);
  });

  test("claiming a ticket marks the event as held", async () => {
    let claimed = false;
    const asked: string[] = [];
    const view = await setup({
      openEvents: async () => ({ items: [openEvent({ claimed })] }),
      claim: async (eventId) => {
        asked.push(eventId);
        claimed = true;
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
            },
            venue: null,
          },
        };
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "รับตั๋ว" }));
    expect(await view.findByText("รับตั๋วแล้ว")).toBeTruthy();
    expect(asked).toEqual(["e-2"]);
    await waitFor(() => expect(view.queryByRole("button", { name: "รับตั๋ว" })).toBeNull());
  });

  test("a full event cannot be claimed", async () => {
    const view = await setup({
      openEvents: async () => ({ items: [openEvent({ remaining: 0 })] }),
      claim: async () => {
        throw new ApiError(409, "ตั๋วกิจกรรมนี้เต็มแล้ว", { code: "full" });
      },
    });
    expect(await view.findByText("เต็มแล้ว")).toBeTruthy();
    const button = view.getByRole("button", { name: "รับตั๋ว" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("says so when nothing is open", async () => {
    const view = await setup({ openEvents: async () => ({ items: [] }) });
    expect(await view.findByText("ตอนนี้ยังไม่มีกิจกรรมที่เปิดรับตั๋ว")).toBeTruthy();
  });
});
