import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { EventItem, EventsApi, Participant, ParticipantList } from "@/lib/events";
import { fakeApis, fakeEventsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { EventParticipantsPage, participantsCsv } from "./events_.$eventId";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";
const CHECKED_AT = new Date(Date.UTC(2026, 11, 5, 2, 15)).toISOString();

const EVENT: EventItem & { canManage: boolean } = {
  id: "e-1",
  type: "sport",
  name: "ฟุตบอลรอบแรก",
  description: null,
  startAt: new Date(Date.UTC(2026, 11, 5, 2)).toISOString(),
  endAt: new Date(Date.UTC(2026, 11, 5, 5)).toISOString(),
  venueId: "v-1",
  thumbnailUrl: null,
  createdBy: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  venue: { id: "v-1", name: "สนามกลาง" },
  institutions: ["kmitl", "kmutt"],
  divisions: [],
  canManage: false,
};

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
    checkin: null,
    ...overrides,
  };
}

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
    checkin: { at: CHECKED_AT, method: "scan", forced: false },
  }),
  participant({
    userId: "u-3",
    name: "Guest X",
    firstName: "",
    divisions: [],
    expected: false,
    checkin: { at: CHECKED_AT, method: "manual", forced: true },
  }),
];

function setup(list: Partial<ParticipantList>, overrides: Partial<EventsApi> = {}) {
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
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ events })}>
        <EventParticipantsPage eventId="e-1" />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

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
          return {
            code: "checked-in",
            person: PEOPLE[0] as Participant,
            checkedInAt: NOW,
            forced: false,
          };
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "เช็คอิน Somchai G" }));
    await waitFor(() => expect(calls).toEqual([["e-1", { userId: "u-1", method: "manual" }]]));
    expect(view.getByRole("button", { name: /เปิด Kiosk/ }).getAttribute("href")).toBe("/kiosk/e-1");
  });

  test("managers undo a check-in", async () => {
    const undone: unknown[] = [];
    const view = await setup(
      { canUndo: true },
      {
        undoCheckIn: async (id, userId) => {
          undone.push([id, userId]);
          return { userId };
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "ยกเลิกการเช็คอิน Malee K" }));
    await waitFor(() => expect(undone).toEqual([["e-1", "u-2"]]));
  });
});

describe("participantsCsv", () => {
  test("one row per person with check-in details", async () => {
    const text = await participantsCsv(PEOPLE).text();
    const rows = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.split(",").slice(0, 2)).toEqual(["user_id", "student_id"]);
    expect(rows[1]).toContain("สจล.");
    expect(rows[1]?.endsWith(",yes,,,")).toBe(true);
    expect(rows[3]).toContain("Guest X");
    expect(rows[3]).toContain(",no,");
    expect(rows[3]?.endsWith(",manual,yes")).toBe(true);
  });
});
