import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { EventInput } from "@it3k/db/event-rules";
import type { EventItem, EventsApi } from "@/lib/events";
import type { Division, Sport } from "@/lib/sports";
import type { Venue } from "@/lib/venues";
import { choose, fakeEventsApi, fakeSportsApi, fakeVenuesApi, renderRoute } from "@/test/query";

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
    division({ id: "d-b5", sportId: "s-basketball", code: "b5", name: "ทีมชาย 5x5" }),
    division({ id: "d-b3", sportId: "s-basketball", code: "b3", name: "ทีมหญิง 3x3" }),
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
  return renderRoute({ options: { component: EventsPage } }, { events, venues, sports });
}

describe("eventIcon", () => {
  test("uses the first sport's illustration, or the general one", () => {
    expect(eventIcon(item())).toBe("basketball");
    expect(eventIcon(item({ divisions: [] }))).toBe("general");
  });
});

describe("/staff/events", () => {
  test("lists events with their time, venue, institutions and sports", async () => {
    const view = setup([item()], false);
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
    const view = setup([], false, {
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
    const view = setup([], true, {
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

  test("editing sends the version; a general event drops sport picks", async () => {
    const updated: unknown[] = [];
    const view = setup([item()], true, {
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
});
