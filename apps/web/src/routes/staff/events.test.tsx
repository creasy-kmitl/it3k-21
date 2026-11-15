import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { EventInput } from "@it3k/db/event-rules";
import type { EventItem, EventsApi } from "@/lib/events";
import type { Division, Sport } from "@/lib/sports";
import type { Venue } from "@/lib/venues";
import { ApiProvider } from "@/lib/api-context";
import { choose, fakeApis, fakeEventsApi, fakeSportsApi, fakeVenuesApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventsPage, eventIcon } from "./events";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";
// 09:00–12:00 on 5 December 2026, Bangkok time.
const START = Date.UTC(2026, 11, 5, 2);
const END = START + 3 * 60 * 60 * 1000;

function division(overrides: Partial<Division>): Division {
  return {
    id: "d-1",
    sportId: "s-football",
    code: "football",
    name: "ฟุตบอล",
    gender: "open",
    format: "team",
    requiresShirtNumber: true,
    requiresBadmintonRank: false,
    requiresGameProfile: false,
    maxPerInstitution: null,
    registrationOpen: true,
    sortOrder: 10,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const BASKETBALL: Sport = {
  id: "s-basketball",
  code: "basketball",
  name: "กีฬาบาสเกตบอล",
  description: null,
  icon: "basketball",
  thumbnailUrl: null,
  sortOrder: 30,
  createdAt: NOW,
  updatedAt: NOW,
  divisions: [
    division({
      id: "d-b5",
      sportId: "s-basketball",
      code: "b5",
      name: "ทีมชาย 5x5",
      gender: "male",
    }),
    division({
      id: "d-b3",
      sportId: "s-basketball",
      code: "b3",
      name: "ทีมหญิง 3x3",
      gender: "female",
    }),
  ],
};

const VENUE: Venue = {
  id: "v-1",
  name: "โรงยิม 1",
  description: null,
  latitude: null,
  longitude: null,
  externalUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function item(overrides: Partial<EventItem> = {}): EventItem {
  return {
    id: "e-1",
    type: "sport",
    name: "บาสรอบแรก",
    slug: null,
    description: null,
    startAt: new Date(START).toISOString(),
    endAt: new Date(END).toISOString(),
    venueId: "v-1",
    thumbnailUrl: null,
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
    ...overrides,
  };
}

function setup(items: EventItem[], canManage: boolean, overrides: Partial<EventsApi> = {}) {
  const events = fakeEventsApi({ list: async () => ({ items, canManage }), ...overrides });
  const venues = fakeVenuesApi({ list: async () => ({ items: [VENUE], canManage }) });
  const sports = fakeSportsApi({ list: async () => ({ items: [BASKETBALL], canManage }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // In a router, because each card links to its participants page.
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ events, venues, sports })}>
        <EventsPage />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("eventIcon", () => {
  test("uses the first sport's illustration, or the general one", () => {
    expect(eventIcon(item())).toBe("basketball");
    expect(eventIcon(item({ divisions: [] }))).toBe("general");
  });
});

describe("/staff/events", () => {
  test("lists events with their time, venue, institutions and sports", async () => {
    const view = await setup([item()], false);
    expect(await view.findByText("บาสรอบแรก")).toBeTruthy();
    expect(view.getByText("กิจกรรมกีฬา")).toBeTruthy();
    expect(view.getByText(/09:00–12:00/)).toBeTruthy();
    expect(view.getByText("โรงยิม 1")).toBeTruthy();
    expect(view.getByText("สจล.")).toBeTruthy();
    expect(view.getByText("กีฬาบาสเกตบอล: ทีมชาย 5x5")).toBeTruthy();
    expect(view.getByRole("img", { name: "บาสรอบแรก" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "เพิ่มกิจกรรม" })).toBeNull();
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

  test("a sport event needs institutions and sports; a sport's box picks all its divisions", async () => {
    const created: EventInput[] = [];
    const view = await setup([], true, {
      create: async (json) => {
        created.push(json);
        return item();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มกิจกรรม" }));
    fireEvent.change(view.getByLabelText("ชื่อกิจกรรม"), { target: { value: "บาสรอบแรก" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    expect(await view.findByText("เลือกอย่างน้อย 1 สถาบัน")).toBeTruthy();
    expect(view.getByText("เลือกอย่างน้อย 1 ประเภทกีฬา")).toBeTruthy();

    fireEvent.click(view.getByRole("checkbox", { name: "สจล." }));
    fireEvent.click(await view.findByRole("checkbox", { name: "กีฬาบาสเกตบอล" }));
    await choose(view.getByRole("button", { name: "เลือกสถานที่" }), "โรงยิม 1");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      type: "sport",
      name: "บาสรอบแรก",
      venueId: "v-1",
      institutions: ["kmitl"],
      divisionIds: ["d-b5", "d-b3"],
    });
    expect((created[0]?.endAt ?? 0) - (created[0]?.startAt ?? 0)).toBe(2 * 60 * 60 * 1000);
  });

  test("the sport picker shows each sport's picture and its divisions' gender chips", async () => {
    const view = await setup([], true);
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มกิจกรรม" }));
    const sport = await view.findByRole("checkbox", { name: "กีฬาบาสเกตบอล" });
    const box = sport.closest(".rounded-xl") as HTMLElement;
    expect(box.querySelector('svg[role="img"]')).toBeTruthy();
    const male = view.getByRole("checkbox", { name: /ทีมชาย 5x5/ });
    expect(view.getByText("0/2")).toBeTruthy();
    expect(male.parentElement?.textContent).toContain("ชาย");
    expect(view.getAllByText("หญิง").length).toBeGreaterThan(0);
    fireEvent.click(male);
    expect(view.getByText("1/2")).toBeTruthy();
  });

  test("editing sends the version; a general event drops sport picks", async () => {
    const updated: unknown[] = [];
    const view = await setup([item()], true, {
      update: async (id, json) => {
        updated.push([id, json]);
        return item();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข บาสรอบแรก" }));
    await choose(view.getByRole("combobox", { name: "ประเภทกิจกรรม" }), "กิจกรรมทั่วไป");
    expect(view.queryByText("สถาบันที่เข้าร่วม")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(updated).toEqual([
        [
          "e-1",
          expect.objectContaining({
            type: "general",
            startAt: START,
            endAt: END,
            institutions: [],
            divisionIds: [],
            version: 2,
          }),
        ],
      ]),
    );
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

  test("the slug follows the name until typed into, with a URL preview", async () => {
    const created: EventInput[] = [];
    const view = await setup([], true, {
      create: async (json) => {
        created.push(json);
        return item();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มกิจกรรม" }));
    await choose(view.getByRole("combobox", { name: "ประเภทกิจกรรม" }), "กิจกรรมทั่วไป");
    const slug = view.getByLabelText("ลิงก์กิจกรรม (slug)") as HTMLInputElement;
    const name = view.getByLabelText("ชื่อกิจกรรม");

    // A Thai name leaves no Latin letters: type and Bangkok date instead.
    fireEvent.change(name, { target: { value: "พิธีเปิด" } });
    expect(slug.value).toMatch(/^general-\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(name, { target: { value: "พิธีเปิด IT3K Opening!" } });
    expect(slug.value).toBe("it3k-opening");
    expect(view.getByText(`${window.location.origin}/staff/events/it3k-opening`)).toBeTruthy();
    expect(view.getByText(`${window.location.origin}/kiosk/it3k-opening`)).toBeTruthy();

    // Left alone, it is sent empty so the API can add "-2" if it is taken.
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ name: "พิธีเปิด IT3K Opening!", slug: "" });
  });

  test("a typed slug is cleaned up, kept through renames and sent as typed", async () => {
    const created: EventInput[] = [];
    const view = await setup([], true, {
      create: async (json) => {
        created.push(json);
        return item();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มกิจกรรม" }));
    await choose(view.getByRole("combobox", { name: "ประเภทกิจกรรม" }), "กิจกรรมทั่วไป");
    const slug = view.getByLabelText("ลิงก์กิจกรรม (slug)") as HTMLInputElement;
    const name = view.getByLabelText("ชื่อกิจกรรม");
    fireEvent.change(name, { target: { value: "Opening" } });
    fireEvent.change(slug, { target: { value: "Day One " } });
    expect(slug.value).toBe("day-one-");
    fireEvent.change(name, { target: { value: "Opening Ceremony" } });
    expect(slug.value).toBe("day-one-");

    // Back to the name, then typed again.
    fireEvent.click(view.getByRole("button", { name: "สร้างจากชื่อ" }));
    expect(slug.value).toBe("opening-ceremony");
    fireEvent.change(slug, { target: { value: "" } });
    expect(slug.value).toBe("opening-ceremony");
    fireEvent.change(slug, { target: { value: "Day One!" } });

    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ slug: "day-one" });
  });

  test("a bad slug is shown on the field", async () => {
    const view = await setup([], true);
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มกิจกรรม" }));
    fireEvent.change(view.getByLabelText("ชื่อกิจกรรม"), { target: { value: "x" } });
    fireEvent.change(view.getByLabelText("ลิงก์กิจกรรม (slug)"), { target: { value: "ab" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    expect(await view.findByText("ยาวอย่างน้อย 3 ตัวอักษร")).toBeTruthy();
  });

  test("editing keeps an event's slug when it is renamed", async () => {
    const updated: unknown[] = [];
    const view = await setup([item({ slug: "basketball-r1" })], true, {
      update: async (id, json) => {
        updated.push([id, json]);
        return item();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข บาสรอบแรก" }));
    const slug = view.getByLabelText("ลิงก์กิจกรรม (slug)") as HTMLInputElement;
    expect(slug.value).toBe("basketball-r1");
    fireEvent.change(view.getByLabelText("ชื่อกิจกรรม"), { target: { value: "Basketball Final" } });
    expect(slug.value).toBe("basketball-r1");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(updated).toEqual([["e-1", expect.objectContaining({ slug: "basketball-r1" })]]),
    );
  });
});
