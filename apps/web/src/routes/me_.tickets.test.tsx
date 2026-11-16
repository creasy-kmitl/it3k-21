import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { OpenEvent, Ticket, TicketsApi } from "@/lib/tickets";
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
    event: {
      id: "e-1",
      slug: "opening",
      type: "general",
      name: "พิธีเปิด",
      startAt: START,
      endAt: END,
      thumbnailUrl: null,
    },
    venue: { id: "v-1", name: "หอประชุม" },
    ...overrides,
  };
}

function openEvent(overrides: Partial<OpenEvent> = {}): OpenEvent {
  return {
    id: "e-2",
    slug: "concert",
    type: "general",
    name: "คอนเสิร์ต",
    description: null,
    startAt: START,
    endAt: END,
    thumbnailUrl: null,
    venue: null,
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
        <TicketsView />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/me/tickets", () => {
  test("shows each ticket's QR and the events still open", async () => {
    const view = await setup({
      mine: async () => ({ items: [ticket()] }),
      openEvents: async () => ({
        // A held ticket's event is not offered again.
        items: [openEvent({ id: "e-1", name: "พิธีเปิด", claimed: true }), openEvent()],
      }),
    });
    expect(await view.findByRole("img", { name: "QR ตั๋ว พิธีเปิด" })).toBeTruthy();
    expect(view.getByText("หอประชุม")).toBeTruthy();
    expect(await view.findByText("คอนเสิร์ต")).toBeTruthy();
    expect(view.getByText("เหลือ 3 ที่")).toBeTruthy();
    expect(view.getAllByRole("button", { name: "รับตั๋ว" })).toHaveLength(1);
  });

  test("claiming a ticket refreshes both lists", async () => {
    let claimed = false;
    const view = await setup({
      mine: async () => ({
        items: claimed
          ? [ticket({ event: { ...ticket().event, id: "e-2", name: "คอนเสิร์ต" } })]
          : [],
      }),
      openEvents: async () => ({ items: [openEvent({ claimed })] }),
      claim: async (eventId) => {
        expect(eventId).toBe("e-2");
        claimed = true;
        return { ticket: ticket() };
      },
    });
    expect(await view.findByText("ยังไม่มีตั๋ว รับตั๋วจากกิจกรรมด้านล่างได้เลย")).toBeTruthy();
    fireEvent.click(await view.findByRole("button", { name: "รับตั๋ว" }));
    expect(await view.findByRole("img", { name: "QR ตั๋ว คอนเสิร์ต" })).toBeTruthy();
    await waitFor(() => expect(view.queryByRole("button", { name: "รับตั๋ว" })).toBeNull());
  });

  test("a full event cannot be claimed", async () => {
    const view = await setup({
      mine: async () => ({ items: [] }),
      openEvents: async () => ({ items: [openEvent({ remaining: 0 })] }),
      claim: async () => {
        throw new ApiError(409, "ตั๋วกิจกรรมนี้เต็มแล้ว", { code: "full" });
      },
    });
    expect(await view.findByText("เต็มแล้ว")).toBeTruthy();
    const button = view.getByRole("button", { name: "รับตั๋ว" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
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
      openEvents: async () => ({ items: [] }),
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
    expect(await view.findByText("ยังไม่มีตั๋ว รับตั๋วจากกิจกรรมด้านล่างได้เลย")).toBeTruthy();
  });
});
