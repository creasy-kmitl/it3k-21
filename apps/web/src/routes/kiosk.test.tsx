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
  description: null,
  startAt: new Date(Date.UTC(2026, 11, 5, 2)).toISOString(),
  endAt: new Date(Date.UTC(2026, 11, 5, 5)).toISOString(),
  venueId: null,
  thumbnailUrl: null,
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
  checkin: null,
  ...overrides,
});

function setup(overrides: Partial<EventsApi> = {}, canCheckIn = true) {
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
        <KioskPage eventId="e-1" decoderFactory={() => Promise.reject(new Error("no camera"))} />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

async function scan(view: Awaited<ReturnType<typeof setup>>, code: string) {
  fireEvent.change(await view.findByLabelText("รหัสผู้ใช้"), { target: { value: code } });
  fireEvent.submit(view.getByLabelText("รหัสผู้ใช้").closest("form") as HTMLFormElement);
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
        const person = { ...PERSON, userId: json.userId, divisions: [] };
        return json.force
          ? { code: "checked-in", person, checkedInAt: NOW, forced: true }
          : { code: "not-listed", person, canForce: true, message: "ไม่อยู่ในรายชื่อของกิจกรรมนี้" };
      },
    });
    await scan(view, "u-9");
    expect(await view.findByRole("alertdialog", { name: "ไม่อยู่ในรายชื่อของกิจกรรมนี้" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "เช็คอินนอกรายชื่อ" }));
    expect(await view.findByRole("alertdialog", { name: "เช็คอินแล้ว (นอกรายชื่อ)" })).toBeTruthy();
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
