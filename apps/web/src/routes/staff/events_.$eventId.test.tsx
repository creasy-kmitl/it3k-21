import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { useState } from "react";

import { ApiProvider } from "@/lib/api-context";
import { participantsCsv, ticketProgress } from "@/components/events/event-participants";
import type {
  CheckinOutcome,
  EventDetail,
  EventsApi,
  Participant,
  ParticipantList,
} from "@/lib/events";
import { fakeApis, fakeEventsApi, fakeSportsApi, fakeUsersApi, fakeVenuesApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventPage, type EventTab } from "./events_.$eventId";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";
const CHECKED_AT = new Date(Date.UTC(2026, 11, 5, 2, 15)).toISOString();

const EVENT: EventDetail = {
  id: "e-1",
  type: "sport",
  name: "ฟุตบอลรอบแรก",
  slug: null,
  description: null,
  content: null,
  startAt: new Date(Date.UTC(2026, 11, 5, 2)).toISOString(),
  endAt: new Date(Date.UTC(2026, 11, 5, 5)).toISOString(),
  venueId: "v-1",
  thumbnailUrl: null,
  ticketsOpen: true,
  ticketCapacity: null,
  ticketCount: 0,
  createdBy: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  venue: { id: "v-1", name: "สนามกลาง" },
  institutions: ["kmitl", "kmutt"],
  divisions: [],
  ticketTypes: [
    {
      id: "tt-1",
      name: "นักกีฬา",
      description: "",
      capacity: null,
      maxPerUser: 1,
      open: true,
      sortOrder: 0,
      listedOnly: true,
      allowedRoles: [],
      allowedInstitutions: [],
      allowedSportIds: [],
      ticketCount: 3,
    },
  ],
  canManage: false,
};

type Checkin = NonNullable<Participant["checkin"]>;
const checkin = (id: string, overrides: Partial<Checkin> = {}): Checkin => ({
  id,
  at: CHECKED_AT,
  method: "scan",
  forced: false,
  ticketId: null,
  ...overrides,
});

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    userId: "u-1",
    name: "Somchai G",
    image: null,
    institution: "kmitl",
    studentId: "65070001",
    prefix: "นาย",
    firstName: "สมชาย",
    lastName: "ใจดี",
    nickname: "ชาย",
    divisions: [{ id: "d-1", name: "ฟุตบอล" }],
    expected: true,
    hasTicket: true,
    tickets: [{ id: "t-1", typeName: "นักกีฬา", checkin: null }],
    checkins: [],
    checkin: null,
    ...overrides,
  };
}

/** Someone checked in once, on their one ticket or (forced) on none. */
const checkedIn = (c: Checkin): Partial<Participant> => ({
  checkin: c,
  checkins: [c],
  tickets: c.ticketId ? [{ id: c.ticketId, typeName: "นักกีฬา", checkin: c }] : [],
  hasTicket: !!c.ticketId,
});

const PEOPLE = [
  participant(),
  participant({
    userId: "u-2",
    name: "Malee K",
    firstName: "มาลี",
    lastName: "รักดี",
    nickname: "ลี",
    institution: "kmutt",
    studentId: "66000002",
    ...checkedIn(checkin("c-2", { ticketId: "t-2" })),
  }),
  participant({
    userId: "u-3",
    name: "Guest X",
    firstName: "",
    divisions: [],
    expected: false,
    ...checkedIn(checkin("c-3", { method: "manual", forced: true })),
  }),
];

function setup(
  list: Partial<ParticipantList>,
  overrides: Partial<EventsApi> = {},
  eventId = "e-1",
  { tab = "participants", tabs }: { tab?: EventTab; tabs?: EventTab[] } = {},
) {
  const events = fakeEventsApi({
    get: async () => EVENT,
    participants: async () => ({
      items: PEOPLE,
      canCheckIn: false,
      canUndo: false,
      canExport: false,
      ...list,
    }),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const apis = fakeApis({
    events,
    venues: fakeVenuesApi({ list: async () => ({ items: [], canManage: true }) }),
    sports: fakeSportsApi({ list: async () => ({ items: [], canManage: true }) }),
    users: fakeUsersApi({ me: async () => ({ id: "u-me" }) as never }),
  });
  function Page() {
    const [current, setCurrent] = useState<EventTab>(tab);
    return (
      <EventPage
        eventId={eventId}
        tab={current}
        onTabChange={(next) => {
          tabs?.push(next);
          setCurrent(next);
        }}
        onDeleted={() => {}}
        decoderFactory={() => Promise.reject(new Error("no camera"))}
      />
    );
  }
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <Page />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

const checkedInOutcome = (overrides: Partial<Extract<CheckinOutcome, { code: "checked-in" }>> = {}) =>
  ({
    code: "checked-in",
    person: PEOPLE[0] as Participant,
    checkinId: "c-9",
    checkedInAt: NOW,
    forced: false,
    ticket: { id: "t-1", typeName: "นักกีฬา", index: 1, total: 1 },
    ...overrides,
  }) satisfies CheckinOutcome;

describe("/staff/events/$eventId", () => {
  test("lists participants with their check-in state and filters them", async () => {
    const view = await setup({});
    expect(await view.findByText("นายสมชาย ใจดี")).toBeTruthy();
    expect(view.getByText("ฟุตบอลรอบแรก")).toBeTruthy();
    expect(view.getByText("เช็คอินแล้ว 2 จาก 3 คน")).toBeTruthy();
    expect(view.getByText("เช็คอิน 09:15")).toBeTruthy();
    expect(view.getByText("เช็คอิน 09:15 · มือ")).toBeTruthy();
    expect(view.getByText("ไม่อยู่ในรายชื่อ")).toBeTruthy();
    // Viewers without rights get no buttons.
    expect(view.queryByRole("button", { name: /เช็คอิน Somchai/ })).toBeNull();
    expect(view.queryByRole("button", { name: /เปิด Kiosk/ })).toBeNull();
    expect(view.queryByRole("button", { name: "สแกนเช็คอิน" })).toBeNull();
    expect(view.queryByRole("button", { name: "ส่งออก CSV" })).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "ยังไม่เช็คอิน" }));
    expect(view.queryByText("นางสาวมาลี รักดี")).toBeNull();
    expect(view.getByText("นายสมชาย ใจดี")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "ทั้งหมด" }));
    fireEvent.change(view.getByLabelText("ค้นหาผู้เข้าร่วม"), { target: { value: "6600" } });
    expect(view.queryByText("นายสมชาย ใจดี")).toBeNull();
    expect(view.getByText("นายมาลี รักดี")).toBeTruthy();
  });

  test("kiosk operators check people in by hand and open the kiosk", async () => {
    const calls: unknown[] = [];
    const view = await setup(
      { canCheckIn: true },
      {
        checkIn: async (id, json) => {
          calls.push([id, json]);
          return checkedInOutcome();
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "เช็คอิน Somchai G" }));
    await waitFor(() => expect(calls).toEqual([["e-1", { userId: "u-1", method: "manual" }]]));
    expect(view.getByRole("button", { name: /เปิด Kiosk/ }).getAttribute("href")).toBe("/kiosk/e-1");
  });

  test("scan mode checks people in from a drawer and refreshes the list", async () => {
    const calls: unknown[] = [];
    let listed = 0;
    const view = await setup(
      { canCheckIn: true },
      {
        participants: async () => {
          listed += 1;
          return { items: PEOPLE, canCheckIn: true, canUndo: false, canExport: false };
        },
        checkIn: async (id, json): Promise<CheckinOutcome> => {
          calls.push([id, json]);
          return checkedInOutcome();
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "สแกนเช็คอิน" }));
    const drawer = await view.findByRole("dialog", { name: "สแกนเช็คอิน" });
    expect(within(drawer).getByText("เช็คอินแล้ว 2 / 3")).toBeTruthy();
    expect(within(drawer).getByText("อุปกรณ์นี้ไม่มีกล้อง ใช้เครื่องสแกนหรือพิมพ์รหัสด้านล่าง")).toBeTruthy();

    const before = listed;
    const box = within(drawer).getByLabelText("รหัสตั๋วหรือรหัสผู้ใช้");
    fireEvent.change(box, { target: { value: " u-1 " } });
    fireEvent.submit(box.closest("form") as HTMLFormElement);

    const result = await within(drawer).findByRole("status", { name: "เช็คอินสำเร็จ" });
    expect(within(result).getByText("นายสมชาย ใจดี (ชาย)")).toBeTruthy();
    expect(within(result).getByText("สจล. · 65070001 · ฟุตบอล")).toBeTruthy();
    expect(calls).toEqual([["e-1", { userId: "u-1", method: "scan" }]]);
    await waitFor(() => expect(listed).toBeGreaterThan(before));

    fireEvent.click(within(result).getByRole("button", { name: "สแกนคนถัดไป" }));
    expect(within(drawer).queryByRole("status", { name: "เช็คอินสำเร็จ" })).toBeNull();
  });

  test("scan mode lets a manager check in someone without a ticket", async () => {
    const calls: unknown[] = [];
    const view = await setup(
      { canCheckIn: true },
      {
        checkIn: async (_, json): Promise<CheckinOutcome> => {
          calls.push(json);
          const person = {
            ...(PEOPLE[0] as Participant),
            userId: "userId" in json ? json.userId : "",
            divisions: [],
          };
          return json.force
            ? checkedInOutcome({ person, forced: true, ticket: null })
            : { code: "no-ticket", person, canForce: true, message: "ยังไม่ได้รับตั๋วกิจกรรมนี้" };
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "สแกนเช็คอิน" }));
    const drawer = await view.findByRole("dialog", { name: "สแกนเช็คอิน" });
    const box = within(drawer).getByLabelText("รหัสตั๋วหรือรหัสผู้ใช้");
    fireEvent.change(box, { target: { value: "u-9" } });
    fireEvent.submit(box.closest("form") as HTMLFormElement);

    const result = await within(drawer).findByRole("status", { name: "ยังไม่ได้รับตั๋วกิจกรรมนี้" });
    fireEvent.click(within(result).getByRole("button", { name: "เช็คอินโดยไม่มีตั๋ว" }));
    expect(await within(drawer).findByRole("status", { name: "เช็คอินแล้ว (บังคับ)" })).toBeTruthy();
    expect(calls).toEqual([
      { userId: "u-9", method: "scan" },
      { userId: "u-9", force: true, method: "scan" },
    ]);
  });

  test("managers undo a check-in", async () => {
    const undone: unknown[] = [];
    const view = await setup(
      { canUndo: true },
      {
        undoCheckIn: async (id, checkinId) => {
          undone.push([id, checkinId]);
          return { id: checkinId, userId: "u-2" };
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "ยกเลิกการเช็คอิน Malee K" }));
    // By the check-in's id, so one of several tickets can be undone.
    await waitFor(() => expect(undone).toEqual([["e-1", "c-2"]]));
  });

  test("only the row being undone spins", async () => {
    let finish = () => {};
    const view = await setup(
      { canUndo: true },
      {
        undoCheckIn: (_id, checkinId) =>
          new Promise((resolve) => {
            finish = () => resolve({ id: checkinId, userId: "u-2" });
          }),
      },
    );
    const malee = await view.findByRole("button", { name: "ยกเลิกการเช็คอิน Malee K" });
    fireEvent.click(malee);
    await waitFor(() => expect(malee.getAttribute("aria-busy")).toBe("true"));
    const guest = view.getByRole("button", { name: "ยกเลิกการเช็คอิน Guest X" });
    expect(guest.hasAttribute("disabled")).toBe(true);
    expect(guest.getAttribute("aria-busy")).toBeNull();
    finish();
    await waitFor(() => expect(malee.getAttribute("aria-busy")).toBeNull());
  });
});

describe("/staff/events/$eventId tickets and tabs", () => {
  test("someone with tickets left can be checked in again, and undo takes the latest", async () => {
    const first = checkin("c-1", { ticketId: "t-1" });
    const second = checkin("c-4", { ticketId: "t-2", at: NOW });
    const undone: string[] = [];
    const view = await setup(
      {
        canCheckIn: true,
        canUndo: true,
        items: [
          participant({
            tickets: [
              { id: "t-1", typeName: "แฟนคลับ", checkin: first },
              { id: "t-2", typeName: "แฟนคลับ", checkin: second },
              { id: "t-3", typeName: "แฟนคลับ", checkin: null },
            ],
            checkins: [first, second],
            checkin: first,
          }),
        ],
      },
      {
        undoCheckIn: async (_id, checkinId) => {
          undone.push(checkinId);
          return { id: checkinId, userId: "u-1" };
        },
      },
    );
    expect(await view.findByText("เช็คอิน 2/3 ใบ")).toBeTruthy();
    expect(view.getByText("แฟนคลับ")).toBeTruthy();
    expect(view.getByRole("button", { name: "เช็คอิน Somchai G" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "ยกเลิกการเช็คอิน Somchai G" }));
    await waitFor(() => expect(undone).toEqual(["c-4"]));
  });

  test("viewers get no tabs, even from an edit link", async () => {
    const view = await setup({}, {}, "e-1", { tab: "edit" });
    expect(await view.findByText("นายสมชาย ใจดี")).toBeTruthy();
    expect(view.queryByRole("tab")).toBeNull();
    expect(view.queryByLabelText("ชื่อกิจกรรม")).toBeNull();
    expect(view.getByRole("button", { name: /ดูหน้ากิจกรรม/ }).getAttribute("href")).toBe("/events/e-1");
  });

  test("managers switch to the edit tab by click or by Mod+2", async () => {
    const tabs: EventTab[] = [];
    const view = await setup({}, { get: async () => ({ ...EVENT, canManage: true }) }, "e-1", {
      tabs,
    });
    fireEvent.click(await view.findByRole("tab", { name: /แก้ไข/ }));
    expect(await view.findByLabelText("ชื่อกิจกรรม")).toBeTruthy();
    expect(tabs).toEqual(["edit"]);

    // jsdom reads as Linux, where Mod is Ctrl.
    fireEvent.keyDown(document, { key: "1", code: "Digit1", ctrlKey: true });
    await waitFor(() => expect(tabs).toEqual(["edit", "participants"]));
    fireEvent.keyDown(document, { key: "2", code: "Digit2", ctrlKey: true });
    await waitFor(() => expect(tabs).toEqual(["edit", "participants", "edit"]));
  });
});

describe("participantsCsv", () => {
  test("one row per person with check-in details", async () => {
    const text = await participantsCsv(PEOPLE).text();
    const rows = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.split(",").slice(0, 2)).toEqual(["user_id", "student_id"]);
    expect(rows[1]).toContain("สจล.");
    expect(rows[0]?.split(",").slice(9, 12)).toEqual(["has_ticket", "ticket_types", "checked_in"]);
    expect(rows[1]?.endsWith(",yes,นักกีฬา,0,,,")).toBe(true);
    expect(rows[3]).toContain("Guest X");
    expect(rows[3]).toContain(",no,");
    expect(rows[3]?.endsWith(",manual,yes")).toBe(true);
  });

  test("ticketProgress counts used tickets for someone holding several", () => {
    expect(ticketProgress(participant())).toBeNull();
    const used = checkin("c-1", { ticketId: "t-1" });
    expect(
      ticketProgress(
        participant({
          tickets: [
            { id: "t-1", typeName: "แฟนคลับ", checkin: used },
            { id: "t-2", typeName: "แฟนคลับ", checkin: null },
          ],
          checkins: [used],
        }),
      ),
    ).toBe("เช็คอิน 1/2 ใบ");
  });

  test("opened by slug, it checks in by the event's id and links the kiosk by slug", async () => {
    const asked: string[] = [];
    const calls: unknown[] = [];
    const view = await setup(
      { canCheckIn: true },
      {
        get: async (ref) => {
          asked.push(ref);
          return { ...EVENT, slug: "football-r1" };
        },
        checkIn: async (id, json) => {
          calls.push([id, json]);
          return checkedInOutcome();
        },
      },
      "football-r1",
    );
    expect(await view.findByText("ฟุตบอลรอบแรก")).toBeTruthy();
    expect(asked).toEqual(["football-r1"]);
    expect((await view.findByRole("button", { name: /เปิด Kiosk/ })).getAttribute("href")).toBe(
      "/kiosk/football-r1",
    );
    fireEvent.click(view.getByRole("button", { name: "เช็คอิน Somchai G" }));
    await waitFor(() => expect(calls).toEqual([["e-1", { userId: "u-1", method: "manual" }]]));
  });
});
