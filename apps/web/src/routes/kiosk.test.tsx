import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CheckinOutcome, EventItem, EventsApi, Participant, Person } from "@/lib/events";
import { fakeApis, fakeEventsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { KioskPage } from "./kiosk.$eventId";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";

const EVENT: EventItem & { canManage: boolean } = {
  id: "e-1",
  type: "sport",
  name: "ฟุตบอลรอบแรก",
  slug: null,
  description: null,
  startAt: new Date(Date.UTC(2026, 11, 5, 2)).toISOString(),
  endAt: new Date(Date.UTC(2026, 11, 5, 5)).toISOString(),
  venueId: null,
  thumbnailUrl: null,
  ticketsOpen: true,
  ticketCapacity: null,
  ticketCount: 0,
  createdBy: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  venue: null,
  institutions: ["kmitl"],
  divisions: [],
  canManage: false,
};

const PERSON: Person = {
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
};

const participant = (overrides: Partial<Participant> = {}): Participant => ({
  ...PERSON,
  expected: true,
  hasTicket: true,
  checkin: null,
  ...overrides,
});

function setup(overrides: Partial<EventsApi> = {}, canCheckIn = true, eventId = "e-1") {
  const events = fakeEventsApi({
    get: async () => EVENT,
    participants: async () => ({
      items: [
        participant(),
        participant({ userId: "u-2", checkin: { at: NOW, method: "scan", forced: false } }),
      ],
      canCheckIn,
      canUndo: false,
      canExport: false,
    }),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ events })}>
        <KioskPage
          eventId={eventId}
          decoderFactory={() => Promise.reject(new Error("no camera"))}
        />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

async function scan(view: Awaited<ReturnType<typeof setup>>, code: string) {
  fireEvent.change(await view.findByLabelText("รหัสตั๋วหรือรหัสผู้ใช้"), { target: { value: code } });
  fireEvent.submit(view.getByLabelText("รหัสตั๋วหรือรหัสผู้ใช้").closest("form") as HTMLFormElement);
}

describe("/kiosk/$eventId", () => {
  test("shows the event, the count, and works without a camera", async () => {
    const view = await setup();
    expect(await view.findByText("ฟุตบอลรอบแรก")).toBeTruthy();
    expect(view.getByText("อุปกรณ์นี้ไม่มีกล้อง ใช้เครื่องสแกนหรือพิมพ์รหัสด้านล่าง")).toBeTruthy();
    await waitFor(() => expect(view.getByText("1")).toBeTruthy());
    expect(view.queryByRole("button", { name: "สลับกล้อง" })).toBeNull();
  });

  test("a scanned code checks in and fills the screen with the person", async () => {
    const calls: unknown[] = [];
    const view = await setup({
      checkIn: async (id, json) => {
        calls.push([id, json]);
        return { code: "checked-in", person: PERSON, checkedInAt: NOW, forced: false };
      },
    });
    await scan(view, " u-1 ");
    expect(await view.findByRole("alertdialog", { name: "เช็คอินสำเร็จ" })).toBeTruthy();
    expect(view.getByText("นายสมชาย ใจดี (ชาย)")).toBeTruthy();
    expect(view.getByText("สจล. · 65070001 · ฟุตบอล")).toBeTruthy();
    expect(calls).toEqual([["e-1", { userId: "u-1", method: "scan" }]]);

    // The same badge again right away is ignored.
    fireEvent.click(view.getByRole("alertdialog"));
    await scan(view, "u-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
  });

  test("opened by slug, it checks in by the event's id", async () => {
    const asked: string[] = [];
    const calls: unknown[] = [];
    const view = await setup(
      {
        get: async (ref) => {
          asked.push(ref);
          return { ...EVENT, slug: "football-r1" };
        },
        checkIn: async (id, json) => {
          calls.push([id, json]);
          return { code: "checked-in", person: PERSON, checkedInAt: NOW, forced: false };
        },
      },
      true,
      "football-r1",
    );
    expect(await view.findByText("ฟุตบอลรอบแรก")).toBeTruthy();
    expect(asked).toEqual(["football-r1"]);
    expect(view.getByRole("button", { name: "ออก" }).getAttribute("href")).toBe(
      "/staff/events/football-r1",
    );
    await scan(view, "u-1");
    await waitFor(() => expect(calls).toEqual([["e-1", { userId: "u-1", method: "scan" }]]));
  });

  test("a ticket's QR code checks in by its ticket code", async () => {
    const calls: unknown[] = [];
    const view = await setup({
      checkIn: async (id, json) => {
        calls.push([id, json]);
        return { code: "checked-in", person: PERSON, checkedInAt: NOW, forced: false };
      },
    });
    const code = "a".repeat(32);
    await scan(view, `it3k-t:${code}`);
    expect(await view.findByRole("alertdialog", { name: "เช็คอินสำเร็จ" })).toBeTruthy();
    expect(calls).toEqual([["e-1", { ticketCode: code, method: "scan" }]]);
  });

  test("someone without a ticket waits for a manager to let them in", async () => {
    const calls: unknown[] = [];
    const view = await setup({
      checkIn: async (_, json): Promise<CheckinOutcome> => {
        calls.push(json);
        return json.force
          ? { code: "checked-in", person: PERSON, checkedInAt: NOW, forced: true }
          : {
              code: "no-ticket",
              person: PERSON,
              canForce: true,
              message: "ยังไม่ได้รับตั๋วกิจกรรมนี้",
            };
      },
    });
    await scan(view, "u-1");
    expect(await view.findByRole("alertdialog", { name: "ยังไม่ได้รับตั๋วกิจกรรมนี้" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "เช็คอินโดยไม่มีตั๋ว" }));
    expect(await view.findByRole("alertdialog", { name: "เช็คอินแล้ว (บังคับ)" })).toBeTruthy();
    expect(calls).toEqual([
      { userId: "u-1", method: "scan" },
      { userId: "u-1", force: true, method: "scan" },
    ]);
  });

  test("a ticket to another event says so", async () => {
    const view = await setup({
      checkIn: async (): Promise<CheckinOutcome> => ({
        code: "wrong-event",
        person: PERSON,
        canForce: false,
        message: "ตั๋วนี้เป็นของกิจกรรมอื่น (พิธีเปิด)",
        otherEvent: { id: "e-2", name: "พิธีเปิด" },
      }),
    });
    await scan(view, `it3k-t:${"b".repeat(32)}`);
    expect(
      await view.findByRole("alertdialog", { name: "ตั๋วนี้เป็นของกิจกรรมอื่น (พิธีเปิด)" }),
    ).toBeTruthy();
    expect(view.queryByRole("button", { name: "เช็คอินโดยไม่มีตั๋ว" })).toBeNull();
  });

  test("a duplicate shows when it was checked in", async () => {
    const view = await setup({
      checkIn: async (): Promise<CheckinOutcome> => ({
        code: "duplicate",
        person: PERSON,
        checkedInAt: new Date(Date.UTC(2026, 11, 5, 2, 15)).toISOString(),
        message: "เช็คอินไปแล้ว",
      }),
    });
    await scan(view, "u-1");
    expect(await view.findByRole("alertdialog", { name: "เช็คอินไปแล้วเมื่อ 09:15" })).toBeTruthy();
  });

  test("managers may check in someone not on the list", async () => {
    const calls: unknown[] = [];
    const view = await setup({
      checkIn: async (_, json): Promise<CheckinOutcome> => {
        calls.push(json);
        const person = { ...PERSON, userId: "userId" in json ? json.userId : "", divisions: [] };
        return json.force
          ? { code: "checked-in", person, checkedInAt: NOW, forced: true }
          : { code: "not-listed", person, canForce: true, message: "ไม่อยู่ในรายชื่อของกิจกรรมนี้" };
      },
    });
    await scan(view, "u-9");
    expect(await view.findByRole("alertdialog", { name: "ไม่อยู่ในรายชื่อของกิจกรรมนี้" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "เช็คอินนอกรายชื่อ" }));
    expect(await view.findByRole("alertdialog", { name: "เช็คอินแล้ว (บังคับ)" })).toBeTruthy();
    expect(calls).toEqual([
      { userId: "u-9", method: "scan" },
      { userId: "u-9", force: true, method: "scan" },
    ]);
  });

  test("an account without kiosk rights is told so", async () => {
    const view = await setup({}, false);
    expect(await view.findByText("บัญชีนี้ไม่มีสิทธิ์ใช้ Kiosk เช็คอิน")).toBeTruthy();
  });
});
