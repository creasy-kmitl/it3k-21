import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { Ticket, TicketsApi } from "@/lib/tickets";
import { fakeApis, fakeTicketsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { TicketView } from "./tickets.$slug";

afterEach(cleanup);

const START = new Date(Date.UTC(2026, 11, 5, 2)).toISOString();
const END = new Date(Date.UTC(2026, 11, 5, 5)).toISOString();

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-1",
    code: "a".repeat(32),
    claimedAt: START,
    checkedInAt: null,
    ticketType: null,
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

function setup(overrides: Partial<TicketsApi>, eventRef = "opening") {
  const tickets = fakeTicketsApi(overrides);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ tickets })}>
        <TicketView eventRef={eventRef} />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/tickets/$slug", () => {
  test("shows the ticket's QR for the event it names", async () => {
    const asked: string[] = [];
    const view = await setup({
      ticketsFor: async (eventRef) => {
        asked.push(eventRef);
        return { tickets: [ticket()] };
      },
    });
    expect(await view.findByRole("img", { name: "QR ตั๋ว พิธีเปิด" })).toBeTruthy();
    expect(asked).toEqual(["opening"]);
    expect(view.getByRole("heading", { name: "พิธีเปิด" })).toBeTruthy();
    expect(view.getByText("หอประชุม")).toBeTruthy();
    expect(view.getByRole("button", { name: "ดูรายละเอียดกิจกรรม" }).getAttribute("href")).toBe(
      "/events/opening",
    );
  });

  test("a used ticket says when it was checked in", async () => {
    const view = await setup({
      ticketsFor: async () => ({ tickets: [ticket({ checkedInAt: START })] }),
    });
    expect(await view.findByText(/^เช็คอินแล้ว \d/)).toBeTruthy();
    expect(view.getByText("ตั๋วนี้ใช้เช็คอินแล้ว")).toBeTruthy();
  });

  test("several tickets each get their own QR, named by type and number", async () => {
    const view = await setup({
      ticketsFor: async () => ({
        tickets: [
          ticket({ ticketType: { id: "tt-1", name: "แฟนคลับ" } }),
          ticket({
            id: "t-2",
            code: "b".repeat(32),
            checkedInAt: START,
            ticketType: { id: "tt-1", name: "แฟนคลับ" },
          }),
        ],
      }),
    });
    expect(await view.findByRole("img", { name: "QR ตั๋ว พิธีเปิด แฟนคลับ ใบที่ 1" })).toBeTruthy();
    expect(view.getByRole("img", { name: "QR ตั๋ว พิธีเปิด แฟนคลับ ใบที่ 2" })).toBeTruthy();
    expect(view.getByText("ใบที่ 2/2")).toBeTruthy();
    expect(view.getAllByText("ตั๋วเข้างาน · แฟนคลับ")).toHaveLength(2);
    // Only the used one says so.
    expect(view.getAllByText("ตั๋วนี้ใช้เช็คอินแล้ว")).toHaveLength(1);
  });

  test("without a ticket, points to the event", async () => {
    const view = await setup(
      {
        ticketsFor: async () => {
          throw new ApiError(404, "ยังไม่ได้รับตั๋วกิจกรรมนี้", { code: "no-ticket" });
        },
      },
      "concert",
    );
    expect(await view.findByText("ไม่พบตั๋วนี้")).toBeTruthy();
    expect(view.getByRole("button", { name: "ไปหน้ากิจกรรม" }).getAttribute("href")).toBe(
      "/events/concert",
    );
  });
});
