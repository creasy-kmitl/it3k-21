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
      ticketFor: async (eventRef) => {
        asked.push(eventRef);
        return { ticket: ticket() };
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
      ticketFor: async () => ({ ticket: ticket({ checkedInAt: START }) }),
    });
    expect(await view.findByText(/^เช็คอินแล้ว \d/)).toBeTruthy();
    expect(view.getByText("ตั๋วนี้ใช้เช็คอินแล้ว")).toBeTruthy();
  });

  test("without a ticket, points to the event", async () => {
    const view = await setup(
      {
        ticketFor: async () => {
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
