import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { EventDetail, OpenTicketType, TicketsApi } from "@/lib/tickets";
import { fakeApis, fakeTicketsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventView } from "./events_.$eventId";

afterEach(cleanup);

const START = new Date(Date.UTC(2026, 11, 5, 2)).toISOString();
const END = new Date(Date.UTC(2026, 11, 5, 5)).toISOString();

function ticketType(overrides: Partial<OpenTicketType> = {}): OpenTicketType {
  return {
    id: "tt-1",
    name: "ทั่วไป",
    description: "",
    capacity: 100,
    remaining: 40,
    maxPerUser: 1,
    open: true,
    held: 0,
    eligible: true,
    canClaim: true,
    refusal: null,
    ...overrides,
  };
}

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "e-2",
    slug: "concert",
    type: "general",
    name: "คอนเสิร์ต",
    description: "ดนตรีสดตลอดคืน",
    content: null,
    startAt: START,
    endAt: END,
    thumbnailUrl: null,
    sports: [],
    venue: { id: "v-1", name: "ลานกิจกรรม", externalUrl: "https://maps.example/v-1" },
    open: true,
    capacity: 100,
    remaining: 40,
    claimed: false,
    ticketTypes: [ticketType()],
    tickets: [],
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
    expect(view.getByRole("link", { name: /ลานกิจกรรม/ }).getAttribute("href")).toBe(
      "https://maps.example/v-1",
    );
    expect(view.getByText("60/100")).toBeTruthy();
    expect(view.getByRole("button", { name: "กิจกรรมทั้งหมด" }).getAttribute("href")).toBe("/events");
  });

  test("claiming swaps the button for a link to the ticket, without the QR", async () => {
    let held = false;
    const view = await setup({
      event: async () =>
        detail(
          held
            ? {
                claimed: true,
                ticketTypes: [ticketType({ held: 1, canClaim: false, refusal: "limit" })],
                tickets: [
                  { id: "t-1", ticketType: { id: "tt-1", name: "ทั่วไป" }, checkedInAt: null },
                ],
              }
            : {},
        ),
      claim: async (_eventId, ticketTypeId) => {
        expect(ticketTypeId).toBe("tt-1");
        held = true;
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
    // The card's button; phones also get a copy pinned to the bottom.
    const [claimButton] = await view.findAllByRole("button", { name: "รับตั๋ว" });
    fireEvent.click(claimButton as HTMLElement);
    const open = await view.findByRole("button", { name: "ดูตั๋ว" });
    expect(open.getAttribute("href")).toBe("/tickets/concert");
    expect(view.getByText("คุณมีตั๋วกิจกรรมนี้แล้ว")).toBeTruthy();
    expect(view.queryByRole("img", { name: /QR/ })).toBeNull();
  });

  test("a closed event says so; a full one cannot be claimed", async () => {
    const closed = await setup({ event: async () => detail({ open: false }) });
    const shut = (await closed.findByRole("button", { name: "ปิดรับตั๋วแล้ว" })) as HTMLButtonElement;
    expect(shut.disabled).toBe(true);
    expect(closed.queryByRole("button", { name: "รับตั๋ว" })).toBeNull();
    cleanup();

    const full = await setup({
      event: async () =>
        detail({
          remaining: 0,
          ticketTypes: [ticketType({ remaining: 0, canClaim: false, refusal: "full" })],
        }),
    });
    const button = (await full.findByRole("button", { name: "ตั๋วเต็มแล้ว" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("shows rich content, and one claim button per type the caller may take", async () => {
    const claimed: string[] = [];
    const view = await setup({
      event: async () =>
        detail({
          content: {
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "กำหนดการ" }] },
              {
                type: "paragraph",
                content: [{ type: "text", text: "เปิดประตู", marks: [{ type: "bold" }] }],
              },
            ],
          },
          ticketTypes: [
            ticketType({ id: "tt-vip", name: "VIP", description: "แถวหน้า", remaining: 2, capacity: 10 }),
            ticketType({ id: "tt-fan", name: "แฟนคลับ", maxPerUser: 3, held: 1 }),
            ticketType({
              id: "tt-sport",
              name: "นักกีฬา",
              canClaim: false,
              refusal: "not-listed",
            }),
            ticketType({ id: "tt-staff", name: "ทีมงาน", eligible: false, canClaim: false }),
          ],
        }),
      claim: async (_eventId, ticketTypeId) => {
        claimed.push(ticketTypeId);
        throw new ApiError(409, "เต็ม", { code: "full" });
      },
    });
    expect(await view.findByRole("heading", { name: "กำหนดการ" })).toBeTruthy();
    expect(view.getByText("เปิดประตู").tagName).toBe("STRONG");
    expect(view.getByText("แถวหน้า")).toBeTruthy();
    expect(view.getByText("เหลือเพียง 2 ที่")).toBeTruthy();
    // A type the caller's rules shut them out of is not shown at all.
    expect(view.queryByText("ทีมงาน")).toBeNull();
    // One they could hold but cannot take now says why.
    expect(view.getByText("เฉพาะนักกีฬาในรายชื่อของกิจกรรมนี้")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "รับตั๋ว นักกีฬา" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(view.getByText("รับได้สูงสุด 3 ใบต่อคน")).toBeTruthy();
    expect(view.getByText("มีแล้ว 1/3")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "รับตั๋ว VIP" }));
    await waitFor(() => expect(claimed).toEqual(["tt-vip"]));
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
