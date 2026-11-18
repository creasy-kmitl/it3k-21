import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import type { EventInput } from "@it3k/db/event-rules";
import { ApiProvider } from "@/lib/api-context";
import type { EventDetail, EventsApi, EventTicketType } from "@/lib/events";
import type { Division, Sport } from "@/lib/sports";
import type { Venue } from "@/lib/venues";
import {
  choose,
  fakeApis,
  fakeEventsApi,
  fakeSportsApi,
  fakeUsersApi,
  fakeVenuesApi,
} from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventEditor } from "./event-editor";

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

function ticketType(overrides: Partial<EventTicketType> = {}): EventTicketType {
  return {
    id: "tt-1",
    name: "ทั่วไป",
    description: "",
    capacity: null,
    maxPerUser: 1,
    open: true,
    sortOrder: 0,
    listedOnly: false,
    allowedRoles: [],
    allowedInstitutions: [],
    allowedSportIds: [],
    ticketCount: 0,
    ...overrides,
  };
}

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "e-1",
    type: "general",
    name: "พิธีเปิด",
    slug: "opening",
    description: null,
    content: null,
    startAt: new Date(START).toISOString(),
    endAt: new Date(END).toISOString(),
    venueId: null,
    thumbnailUrl: null,
    ticketsOpen: false,
    ticketCapacity: null,
    ticketCount: 0,
    createdBy: "u-1",
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    venue: null,
    institutions: [],
    divisions: [],
    ticketTypes: [ticketType()],
    canManage: true,
    ...overrides,
  };
}

type Saved = [string, EventInput & { version: number }];

function setup(event: EventDetail, overrides: Partial<EventsApi> = {}) {
  const saved: Saved[] = [];
  const events = fakeEventsApi({
    update: async (id, json) => {
      saved.push([id, json]);
      const { canManage: _, ...rest } = event;
      return { ...rest, slug: json.slug || event.slug, version: event.version + 1 };
    },
    ...overrides,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const apis = fakeApis({
    events,
    venues: fakeVenuesApi({ list: async () => ({ items: [VENUE], canManage: true }) }),
    sports: fakeSportsApi({ list: async () => ({ items: [BASKETBALL], canManage: true }) }),
    // Never answers, so the content box stays a placeholder: Tiptap is not under test here.
    users: fakeUsersApi({ me: () => new Promise(() => {}) }),
  });
  return renderAtRoot(
    () => (
      <QueryClientProvider client={client}>
        <ApiProvider value={apis}>
          <EventEditor event={event} onDeleted={() => {}} />
        </ApiProvider>
      </QueryClientProvider>
    ),
    `/staff/events/${event.slug ?? event.id}`,
  ).then((view) => ({ ...view, saved }));
}

const saveBar = (view: Awaited<ReturnType<typeof setup>>) =>
  view.getByRole("region", { name: "บันทึกการแก้ไข" });
const save = (view: Awaited<ReturnType<typeof setup>>) =>
  fireEvent.click(within(saveBar(view)).getByRole("button", { name: /บันทึก/ }));

describe("EventEditor", () => {
  test("the save bar shows only once something changed, and saves with the version", async () => {
    const view = await setup(detail());
    const name = (await view.findByLabelText("ชื่อกิจกรรม")) as HTMLInputElement;
    expect(view.queryByRole("region", { name: "บันทึกการแก้ไข" })).toBeNull();
    fireEvent.change(name, { target: { value: "พิธีเปิดงาน" } });
    save(view);
    await waitFor(() => expect(view.saved).toHaveLength(1));
    expect(view.saved[0]).toEqual([
      "e-1",
      expect.objectContaining({
        name: "พิธีเปิดงาน",
        // The slug was set before, so a rename keeps it.
        slug: "opening",
        type: "general",
        startAt: START,
        endAt: END,
        content: null,
        version: 3,
        ticketTypes: [expect.objectContaining({ id: "tt-1", name: "ทั่วไป", maxPerUser: 1 })],
      }),
    ]);
  });

  test("going back to how it was hides the save bar", async () => {
    const view = await setup(detail());
    const name = (await view.findByLabelText("ชื่อกิจกรรม")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "x" } });
    expect(saveBar(view)).toBeTruthy();
    fireEvent.change(name, { target: { value: "พิธีเปิด" } });
    expect(view.queryByRole("region", { name: "บันทึกการแก้ไข" })).toBeNull();
  });

  test("Mod+S saves, even from inside a text field", async () => {
    const view = await setup(detail());
    const name = await view.findByLabelText("ชื่อกิจกรรม");
    // Nothing to save yet: the browser's own Ctrl+S is left alone.
    fireEvent.keyDown(name, { key: "s", code: "KeyS", ctrlKey: true });
    expect(view.saved).toHaveLength(0);
    fireEvent.change(name, { target: { value: "พิธีเปิดใหญ่" } });
    fireEvent.keyDown(name, { key: "s", code: "KeyS", ctrlKey: true });
    await waitFor(() => expect(view.saved).toHaveLength(1));
    expect(view.saved[0]?.[1].name).toBe("พิธีเปิดใหญ่");
  });

  test("a sport event needs institutions and sports; a sport's box picks all its divisions", async () => {
    const view = await setup(detail({ type: "sport", ticketTypes: [ticketType({ listedOnly: true })] }));
    const name = await view.findByLabelText("ชื่อกิจกรรม");
    fireEvent.change(name, { target: { value: "บาสรอบแรก" } });
    save(view);
    expect(await view.findByText("เลือกอย่างน้อย 1 สถาบัน")).toBeTruthy();
    expect(view.getByText("เลือกอย่างน้อย 1 ประเภทกีฬา")).toBeTruthy();
    expect(view.saved).toHaveLength(0);

    fireEvent.click(view.getByRole("checkbox", { name: "สจล." }));
    fireEvent.click(await view.findByRole("checkbox", { name: "กีฬาบาสเกตบอล" }));
    await choose(view.getByRole("button", { name: "เลือกสถานที่" }), "โรงยิม 1");
    save(view);
    await waitFor(() => expect(view.saved).toHaveLength(1));
    expect(view.saved[0]?.[1]).toMatchObject({
      type: "sport",
      venueId: "v-1",
      institutions: ["kmitl"],
      divisionIds: ["d-b5", "d-b3"],
      ticketTypes: [expect.objectContaining({ listedOnly: true })],
    });
  });

  test("the sport picker shows each sport's picture and its divisions' gender chips", async () => {
    const view = await setup(detail({ type: "sport" }));
    const sport = await view.findByRole("checkbox", { name: "กีฬาบาสเกตบอล" });
    const box = sport.closest(".rounded-xl") as HTMLElement;
    expect(box.querySelector('svg[role="img"]')).toBeTruthy();
    const male = view.getByRole("checkbox", { name: /ทีมชาย 5x5/ });
    expect(view.getByText("0/2")).toBeTruthy();
    expect(male.parentElement?.textContent).toContain("ชาย");
    fireEvent.click(male);
    expect(view.getByText("1/2")).toBeTruthy();
  });

  test("turning a sport event general drops its sport picks and listed-only rule", async () => {
    const view = await setup(
      detail({
        type: "sport",
        institutions: ["kmitl"],
        divisions: [
          {
            id: "d-b5",
            name: "ทีมชาย 5x5",
            sportId: "s-basketball",
            sportName: "กีฬาบาสเกตบอล",
            icon: "basketball",
          },
        ],
        ticketTypes: [ticketType({ listedOnly: true })],
      }),
    );
    await choose(await view.findByRole("combobox", { name: "ประเภทกิจกรรม" }), "กิจกรรมทั่วไป");
    expect(view.queryByText("สถาบันที่เข้าร่วม")).toBeNull();
    save(view);
    await waitFor(() => expect(view.saved).toHaveLength(1));
    expect(view.saved[0]?.[1]).toMatchObject({
      type: "general",
      institutions: [],
      divisionIds: [],
      ticketTypes: [expect.objectContaining({ listedOnly: false })],
    });
  });

  test("tickets open with a total limit and a new type with its own rules", async () => {
    const view = await setup(detail());
    fireEvent.click(await view.findByRole("checkbox", { name: /เปิดรับตั๋ว$/ }));
    const capacity = view.getByLabelText("จำนวนตั๋วรวมสูงสุด");
    fireEvent.change(capacity, { target: { value: "0" } });
    save(view);
    expect(await view.findByText("อย่างน้อย 1 ใบ")).toBeTruthy();
    fireEvent.change(capacity, { target: { value: "200" } });

    fireEvent.click(view.getByRole("button", { name: "เพิ่มประเภทตั๋ว" }));
    // A new type opens ready to fill in.
    const names = view.getAllByLabelText("ชื่อประเภทตั๋ว") as HTMLInputElement[];
    const added = names.at(-1) as HTMLInputElement;
    fireEvent.change(added, { target: { value: "ทั่วไป " } });
    save(view);
    expect(await view.findByText("ชื่อประเภทตั๋วซ้ำกัน")).toBeTruthy();

    fireEvent.change(added, { target: { value: "VIP" } });
    const amounts = view.getAllByLabelText("จำนวนตั๋ว");
    fireEvent.change(amounts.at(-1) as HTMLElement, { target: { value: "20" } });
    const perUser = view.getAllByLabelText("สูงสุดต่อคน");
    fireEvent.change(perUser.at(-1) as HTMLElement, { target: { value: "2" } });
    const staffOnly = view.getAllByRole("checkbox", { name: "Staff" });
    fireEvent.click(staffOnly.at(-1) as HTMLElement);
    save(view);
    await waitFor(() => expect(view.saved).toHaveLength(1));
    const sent = view.saved[0]?.[1];
    expect(sent).toMatchObject({ ticketsOpen: true, ticketCapacity: 200 });
    expect(sent?.ticketTypes).toEqual([
      expect.objectContaining({ id: "tt-1", name: "ทั่วไป" }),
      expect.objectContaining({
        name: "VIP",
        capacity: 20,
        maxPerUser: 2,
        allowedRoles: ["staff"],
      }),
    ]);
    // A new type has no id yet; the API makes one.
    expect(sent?.ticketTypes[1]?.id).toBeUndefined();
  });

  test("a type someone already holds cannot be deleted", async () => {
    const view = await setup(detail({ ticketTypes: [ticketType({ ticketCount: 4 })] }));
    fireEvent.click(await view.findByRole("button", { name: "ตัวเลือกของ ทั่วไป" }));
    const item = await view.findByRole("menuitem", { name: /มีคนรับแล้ว ลบไม่ได้/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });

  test("leaving with unsaved edits asks in a dialog, not the browser's", async () => {
    let confirmed = 0;
    const original = window.confirm;
    window.confirm = () => {
      confirmed += 1;
      return true;
    };
    try {
      const view = await setup(detail());
      const name = await view.findByLabelText("ชื่อกิจกรรม");
      fireEvent.change(name, { target: { value: "ยังไม่บันทึก" } });

      void view.router.navigate({ to: "/" });
      const dialog = await view.findByRole("alertdialog", { name: "ออกจากหน้านี้โดยไม่บันทึก?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "อยู่ต่อ" }));
      await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
      expect(view.router.state.location.pathname).toBe("/staff/events/opening");

      void view.router.navigate({ to: "/" });
      fireEvent.click(
        within(await view.findByRole("alertdialog")).getByRole("button", { name: "ออกโดยไม่บันทึก" }),
      );
      expect(await view.findByText("home page")).toBeTruthy();
      expect(confirmed).toBe(0);
    } finally {
      window.confirm = original;
    }
  });

  test("a new slug moves the page to it, staying on the edit tab", async () => {
    const view = await setup(detail());
    const slug = (await view.findByLabelText("ลิงก์กิจกรรม (slug)")) as HTMLInputElement;
    fireEvent.change(slug, { target: { value: "grand-opening" } });
    save(view);
    await waitFor(() =>
      expect(view.router.state.location.href).toBe("/staff/events/grand-opening?tab=edit"),
    );
    expect(view.saved[0]?.[1].slug).toBe("grand-opening");
  });
});
