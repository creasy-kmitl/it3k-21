import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { Ticket, TicketsApi } from "@/lib/tickets";
import { fakeApis, fakeTicketsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { TicketsView } from "./me_.tickets";

afterEach(cleanup);

const START = new Date(Date.UTC(2026, 11, 5, 2)).toISOString();
const END = new Date(Date.UTC(2026, 11, 5, 5)).toISOString();

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-1",
    code: "a".repeat(32),
    claimedAt: START,
    checkedInAt: null,
    ticketType: { id: "tt-1", name: "ผู้ชมทั่วไป" },
    event: {
      id: "e-1",
      slug: "opening",
      type: "general",
      name: "พิธีเปิด",
      startAt: START,
      endAt: END,
      thumbnailUrl: null,
      sports: [],
    },
    venue: { id: "v-1", name: "หอประชุม" },
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
        <TicketsView />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/me/tickets", () => {
  test("each ticket opens its own page; the QR is not shown here", async () => {
    const view = await setup({ mine: async () => ({ items: [ticket()] }) });
    expect(await view.findByText("หอประชุม")).toBeTruthy();
    expect(view.getByRole("button", { name: "แสดงตั๋ว" }).getAttribute("href")).toBe(
      "/tickets/opening",
    );
    expect(view.queryByRole("img", { name: "QR ตั๋ว พิธีเปิด" })).toBeNull();
    expect(view.getByRole("button", { name: "ดูกิจกรรม" }).getAttribute("href")).toBe("/events");
    // Claiming lives on /events now.
    expect(view.queryByRole("button", { name: "รับตั๋ว" })).toBeNull();
  });

  test("a ticket is handed back after confirming; a used one cannot be", async () => {
    const cancelled: string[] = [];
    const view = await setup({
      mine: async () => ({
        items: cancelled.length
          ? []
          : [
              ticket(),
              ticket({
                id: "t-2",
                code: "b".repeat(32),
                checkedInAt: START,
                event: { ...ticket().event, id: "e-3", name: "งานเลี้ยง" },
              }),
            ],
      }),
      cancel: async (ticketId) => {
        cancelled.push(ticketId);
        return { id: ticketId };
      },
    });
    expect(await view.findByText(/เช็คอินแล้ว/)).toBeTruthy();
    // Only the unused ticket offers to be handed back.
    const buttons = view.getAllByRole("button", { name: "ยกเลิกตั๋ว" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    const dialog = await view.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิกตั๋ว" }));
    await waitFor(() => expect(cancelled).toEqual(["t-1"]));
    expect(await view.findByRole("button", { name: "รับตั๋วได้ที่หน้ากิจกรรม" })).toBeTruthy();
  });
});
