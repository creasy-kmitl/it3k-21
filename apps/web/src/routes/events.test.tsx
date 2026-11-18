import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { OpenEvent, OpenTicketType, TicketsApi } from "@/lib/tickets";
import { fakeApis, fakeTicketsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventsView } from "./events";

afterEach(cleanup);

const START = new Date(Date.UTC(2026, 11, 5, 2)).toISOString();
const END = new Date(Date.UTC(2026, 11, 5, 5)).toISOString();

function ticketType(overrides: Partial<OpenTicketType> = {}): OpenTicketType {
  return {
    id: "tt-1",
    name: "ทั่วไป",
    description: "",
    capacity: 100,
    remaining: 3,
    maxPerUser: 1,
    open: true,
    held: 0,
    eligible: true,
    canClaim: true,
    refusal: null,
    ...overrides,
  };
}

function openEvent(
  overrides: Partial<OpenEvent> = {},
  types: OpenTicketType[] = [ticketType()],
): OpenEvent {
  return {
    id: "e-2",
    slug: "concert",
    type: "general",
    name: "คอนเสิร์ต",
    description: "ดนตรีสด",
    content: null,
    startAt: START,
    endAt: END,
    thumbnailUrl: null,
    sports: [],
    venue: { id: "v-1", name: "ลานกิจกรรม", externalUrl: null },
    open: true,
    capacity: 100,
    remaining: 3,
    claimed: false,
    ticketTypes: types,
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
          openEvent({ id: "e-3", name: "งานเลี้ยง", remaining: null }, [
            ticketType({ capacity: null, remaining: null }),
          ]),
          openEvent({ id: "e-5", name: "งานกาลา", capacity: null, remaining: null }, [
            ticketType({ id: "tt-a", name: "ที่นั่ง VIP" }),
            ticketType({ id: "tt-b", name: "ยืน" }),
            ticketType({ id: "tt-c", name: "เฉพาะทีมงาน", eligible: false, canClaim: false }),
          ]),
        ],
      }),
    });
    expect(await view.findByText("คอนเสิร์ต")).toBeTruthy();
    // 3 of 100 left reads as running out, with a bar of the 97 taken.
    expect(view.getByText("เหลือเพียง 3 ที่")).toBeTruthy();
    expect(view.getByText("97/100")).toBeTruthy();
    expect(view.getByRole("progressbar", { name: "ตั๋วที่รับไปแล้ว" })).toBeTruthy();
    // The whole card opens the event's page, by slug when it has one.
    expect(view.getByRole("link", { name: "คอนเสิร์ต" }).getAttribute("href")).toBe(
      "/events/concert",
    );
    expect(view.getAllByText("ไม่จำกัดจำนวน")).toHaveLength(2);
    expect(view.getByText("รับตั๋วแล้ว")).toBeTruthy();
    // A held ticket opens its own page, where the QR is.
    expect(view.getByRole("button", { name: "ดูตั๋ว" }).getAttribute("href")).toBe("/tickets/concert");
    expect(view.getAllByRole("button", { name: "รับตั๋ว" })).toHaveLength(2);
    // Several types to choose from send the claim to the event's page,
    // counting only the ones the caller may take.
    expect(
      view.getByRole("button", { name: "เลือกประเภทตั๋ว (2)" }).getAttribute("href"),
    ).toBe("/events/concert");
  });

  test("claiming a ticket marks the event as held", async () => {
    let claimed = false;
    const asked: string[][] = [];
    const view = await setup({
      openEvents: async () => ({ items: [openEvent({ claimed })] }),
      claim: async (eventId, ticketTypeId) => {
        asked.push([eventId, ticketTypeId]);
        claimed = true;
        return {
          ticket: {
            id: "t-1",
            code: "a".repeat(32),
            claimedAt: START,
            checkedInAt: null,
            ticketType: { id: "tt-1", name: "ทั่วไป" },
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
    expect(await view.findByText("รับตั๋วแล้ว")).toBeTruthy();
    expect(asked).toEqual([["e-2", "tt-1"]]);
    await waitFor(() => expect(view.queryByRole("button", { name: "รับตั๋ว" })).toBeNull());
  });

  test("a full event cannot be claimed", async () => {
    const view = await setup({
      openEvents: async () => ({
        items: [
          openEvent({ remaining: 0 }, [ticketType({ remaining: 0, canClaim: false, refusal: "full" })]),
        ],
      }),
      claim: async () => {
        throw new ApiError(409, "ตั๋วกิจกรรมนี้เต็มแล้ว", { code: "full" });
      },
    });
    expect(await view.findByText("เต็มแล้ว")).toBeTruthy();
    const button = view.getByRole("button", { name: "ตั๋วเต็มแล้ว" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("filters by event type and by tickets held", async () => {
    const view = await setup({
      openEvents: async () => ({
        items: [
          openEvent({ id: "e-1", name: "พิธีเปิด", claimed: true }),
          openEvent({
            id: "e-4",
            type: "sport",
            name: "ฟุตบอลรอบแรก",
            sports: [{ id: "s-1", name: "กีฬาฟุตบอล", icon: "football" }],
          }),
        ],
      }),
    });
    expect(await view.findByText("2 กิจกรรม")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "กิจกรรมกีฬา" }));
    expect(view.getByText("1 กิจกรรม")).toBeTruthy();
    expect(view.getByText("ฟุตบอลรอบแรก")).toBeTruthy();
    expect(view.getByText("กีฬาฟุตบอล")).toBeTruthy();
    expect(view.queryByText("พิธีเปิด")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "มีตั๋วแล้ว" }));
    expect(view.getByText("พิธีเปิด")).toBeTruthy();
    expect(view.queryByText("ฟุตบอลรอบแรก")).toBeNull();
  });

  test("says so when nothing is open", async () => {
    const view = await setup({ openEvents: async () => ({ items: [] }) });
    expect(await view.findByText("ตอนนี้ยังไม่มีกิจกรรมที่เปิดรับตั๋ว")).toBeTruthy();
  });
});
