import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { EventDraftInput } from "@it3k/db/event-rules";
import type { EventItem, EventsApi } from "@/lib/events";
import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import { fakeApis, fakeEventsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventsPage, eventIcon } from "./events";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";
// 09:00–12:00 on 5 December 2026, Bangkok time.
const START = Date.UTC(2026, 11, 5, 2);
const END = START + 3 * 60 * 60 * 1000;

function item(overrides: Partial<EventItem> = {}): EventItem {
  return {
    id: "e-1",
    type: "sport",
    name: "บาสรอบแรก",
    slug: null,
    description: null,
    content: null,
    startAt: new Date(START).toISOString(),
    endAt: new Date(END).toISOString(),
    venueId: "v-1",
    thumbnailUrl: null,
    ticketsOpen: false,
    ticketCapacity: null,
    ticketCount: 0,
    createdBy: "u-1",
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
    venue: { id: "v-1", name: "โรงยิม 1" },
    institutions: ["kmitl", "kmutt"],
    divisions: [
      {
        id: "d-b5",
        name: "ทีมชาย 5x5",
        sportId: "s-basketball",
        sportName: "กีฬาบาสเกตบอล",
        icon: "basketball",
      },
    ],
    ticketTypes: [],
    ...overrides,
  };
}

function setup(items: EventItem[], canManage: boolean, overrides: Partial<EventsApi> = {}) {
  const events = fakeEventsApi({ list: async () => ({ items, canManage }), ...overrides });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // In a router, because each card links to its participants page.
  return renderAtRoot(
    () => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ events })}>
        <EventsPage />
      </ApiProvider>
    </QueryClientProvider>
    ),
    "/staff/events",
  );
}

/** Opens the create dialog and fills in a name. */
async function openCreate(view: Awaited<ReturnType<typeof setup>>) {
  fireEvent.click(await view.findByRole("button", { name: /เพิ่มกิจกรรม/ }));
  return {
    name: view.getByLabelText("ชื่อกิจกรรม") as HTMLInputElement,
    slug: view.getByLabelText("ลิงก์กิจกรรม (slug)") as HTMLInputElement,
    submit: () => fireEvent.click(view.getByRole("button", { name: "สร้างแล้วแก้ไขต่อ" })),
  };
}

describe("eventIcon", () => {
  test("uses the first sport's illustration, or the general one", () => {
    expect(eventIcon(item())).toBe("basketball");
    expect(eventIcon(item({ divisions: [] }))).toBe("general");
  });
});

describe("/staff/events", () => {
  test("lists events with their time, venue, institutions and sports", async () => {
    const view = await setup([item({ description: "รอบแรก\nของบาส" })], false);
    expect(await view.findByText("บาสรอบแรก")).toBeTruthy();
    expect(view.getByText("กิจกรรมกีฬา")).toBeTruthy();
    expect(view.getByText(/09:00–12:00/)).toBeTruthy();
    expect(view.getByText("โรงยิม 1")).toBeTruthy();
    expect(view.getByText("สจล.")).toBeTruthy();
    expect(view.getByText("กีฬาบาสเกตบอล: ทีมชาย 5x5")).toBeTruthy();
    expect(view.getByRole("img", { name: "บาสรอบแรก" })).toBeTruthy();
    // The plain-text summary the API makes from the content, cut short.
    expect(view.getByText(/รอบแรก\s+ของบาส/).className).toContain("line-clamp-3");
    expect(view.queryByRole("button", { name: /เพิ่มกิจกรรม/ })).toBeNull();
    expect(view.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
  });

  test("shows past events on request", async () => {
    const filters: unknown[] = [];
    const view = await setup([], false, {
      list: async (query) => {
        filters.push(query);
        return { items: [], canManage: false };
      },
    });
    expect(await view.findByText("ไม่มีกิจกรรมที่กำลังจะมาถึง")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "แสดงที่จบแล้ว" }));
    await waitFor(() => expect(filters.at(-1)).toEqual({}));
    expect((filters[0] as { endsAfter?: number }).endsAfter).toBeNumber();
  });

  test("the card counts tickets", async () => {
    const view = await setup([item({ ticketsOpen: true, ticketCapacity: 50, ticketCount: 12 })], true);
    expect(await view.findByText("ตั๋ว 12/50 ใบ · เปิดรับ")).toBeTruthy();
  });

  test("cards link by slug, or by id for an event without one", async () => {
    const view = await setup(
      [item(), item({ id: "e-2", name: "บาสรอบสอง", slug: "basketball-r2" })],
      false,
    );
    const first = await view.findByRole("link", { name: "บาสรอบแรก" });
    expect(first.getAttribute("href")).toBe("/staff/events/e-1");
    const second = view.getByRole("link", { name: "บาสรอบสอง" });
    expect(second.getAttribute("href")).toBe("/staff/events/basketball-r2");
  });

  test("the pencil opens the event's edit tab", async () => {
    const view = await setup([item({ slug: "basketball-r1" })], true);
    const edit = await view.findByRole("button", { name: "แก้ไข บาสรอบแรก" });
    expect(edit.getAttribute("href")).toBe("/staff/events/basketball-r1?tab=edit");
  });

  test("creating asks only for a name and slug, then goes on to the edit tab", async () => {
    const created: EventDraftInput[] = [];
    const view = await setup([], true, {
      create: async (json) => {
        created.push(json);
        return item({ name: json.name, slug: "it3k-opening" });
      },
    });
    const form = await openCreate(view);
    // Nothing else is asked here.
    expect(view.queryByRole("combobox", { name: "ประเภทกิจกรรม" })).toBeNull();
    expect(view.queryByLabelText("จำนวนตั๋วสูงสุด")).toBeNull();

    // A Thai name leaves no Latin letters: type and Bangkok date instead.
    fireEvent.change(form.name, { target: { value: "พิธีเปิด" } });
    expect(form.slug.value).toMatch(/^general-\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(form.name, { target: { value: "พิธีเปิด IT3K Opening!" } });
    expect(form.slug.value).toBe("it3k-opening");
    expect(view.getByText(`${window.location.origin}/events/it3k-opening`)).toBeTruthy();
    expect(view.getByText(`${window.location.origin}/kiosk/it3k-opening`)).toBeTruthy();

    // Left alone, it is sent empty so the API can add "-2" if it is taken.
    form.submit();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({ name: "พิธีเปิด IT3K Opening!", slug: "" });
    await waitFor(() =>
      expect(view.router.state.location.href).toBe("/staff/events/it3k-opening?tab=edit"),
    );
  });

  test("a typed slug is cleaned up, kept through renames and sent as typed", async () => {
    const created: EventDraftInput[] = [];
    const view = await setup([], true, {
      create: async (json) => {
        created.push(json);
        return item();
      },
    });
    const form = await openCreate(view);
    fireEvent.change(form.name, { target: { value: "Opening" } });
    fireEvent.change(form.slug, { target: { value: "Day One " } });
    expect(form.slug.value).toBe("day-one-");
    fireEvent.change(form.name, { target: { value: "Opening Ceremony" } });
    expect(form.slug.value).toBe("day-one-");

    // Back to the name, then typed again.
    fireEvent.click(view.getByRole("button", { name: "สร้างจากชื่อ" }));
    expect(form.slug.value).toBe("opening-ceremony");
    fireEvent.change(form.slug, { target: { value: "" } });
    expect(form.slug.value).toBe("opening-ceremony");
    fireEvent.change(form.slug, { target: { value: "Day One!" } });

    form.submit();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ slug: "day-one" });
    // An event without a slug opens by its id.
    await waitFor(() => expect(view.router.state.location.href).toBe("/staff/events/e-1?tab=edit"));
  });

  test("a bad slug, or one already taken, is shown on the field", async () => {
    const view = await setup([], true, {
      create: async () => {
        throw new ApiError(409, "ลิงก์นี้มีกิจกรรมอื่นใช้แล้ว", { code: "slug-taken" });
      },
    });
    const form = await openCreate(view);
    fireEvent.change(form.name, { target: { value: "x" } });
    fireEvent.change(form.slug, { target: { value: "ab" } });
    form.submit();
    expect(await view.findByText("ยาวอย่างน้อย 3 ตัวอักษร")).toBeTruthy();

    fireEvent.change(form.slug, { target: { value: "opening" } });
    form.submit();
    expect(await view.findByText("ลิงก์นี้มีกิจกรรมอื่นใช้แล้ว")).toBeTruthy();
    expect(view.router.state.location.pathname).toBe("/staff/events");
  });

  test("N opens the create dialog for managers, but not while typing", async () => {
    const view = await setup([item()], true);
    await view.findByText("บาสรอบแรก");
    fireEvent.keyDown(document, { key: "n", code: "KeyN" });
    const name = await view.findByLabelText("ชื่อกิจกรรม");
    // Typing an "n" into the dialog does not open another one.
    fireEvent.keyDown(name, { key: "n", code: "KeyN" });
    expect(view.getAllByLabelText("ชื่อกิจกรรม")).toHaveLength(1);
    cleanup();

    const staff = await setup([item()], false);
    await staff.findByText("บาสรอบแรก");
    fireEvent.keyDown(document, { key: "n", code: "KeyN" });
    expect(staff.queryByLabelText("ชื่อกิจกรรม")).toBeNull();
  });
});
