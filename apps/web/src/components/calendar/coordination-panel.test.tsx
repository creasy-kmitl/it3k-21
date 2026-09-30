import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type {
  CalendarActionItem,
  CalendarActionInput,
  CalendarActionUpdate,
  CalendarApi,
  CalendarItemDetail,
} from "@/lib/calendar";
import {
  CALENDAR_NOW,
  calendarItem,
  fakeApi,
  fakeCalendarApi,
  fakeUsersApi,
  renderWithQuery,
} from "@/test/query";

import { CoordinationPanel } from "./coordination-panel";

afterEach(cleanup);

function action(overrides: Partial<CalendarActionItem> = {}): CalendarActionItem {
  return {
    id: crypto.randomUUID(),
    itemId: "item-1",
    itemTitle: "ประชุมข้ามฝ่าย",
    itemStartAt: CALENDAR_NOW,
    title: "ส่งรายชื่อทีม",
    owner: { id: "u-sports", name: "Sports Staff" },
    department: { id: "d-sports", name: "กีฬา" },
    dueAt: CALENDAR_NOW + 60 * 60 * 1000,
    status: "open",
    doneAt: null,
    version: 3,
    canEdit: false,
    canComplete: true,
    ...overrides,
  };
}

function detail(overrides: Partial<CalendarItemDetail> = {}): CalendarItemDetail {
  return {
    ...calendarItem({ id: "item-1", mode: "coordination", category: "cross_team_meeting" }),
    departments: [
      {
        id: "d-sports",
        name: "กีฬา",
        state: "requested",
        request: "ขอตารางแข่ง",
        contact: null,
        dueAt: null,
        response: null,
        answeredAt: null,
        canAnswer: true,
      },
    ],
    actionItems: [],
    decisions: [],
    carriedOver: [],
    checklist: null,
    canCheck: false,
    dependsOn: [],
    blocks: [],
    changes: [],
    canApprove: false,
    ...overrides,
  };
}

function render(item: CalendarItemDetail, api: Partial<CalendarApi> = {}) {
  return renderWithQuery(
    <ApiProvider
      value={{ calendar: fakeCalendarApi(api), leadership: fakeApi(), users: fakeUsersApi() }}
    >
      <CoordinationPanel item={item} />
    </ApiProvider>,
  );
}

describe("CoordinationPanel", () => {
  test("a department member answers what was asked of them", async () => {
    const answers: [string, string, string][] = [];
    render(detail({ canEdit: false }), {
      answer: async (itemId, departmentId, response) => {
        answers.push([itemId, departmentId, response]);
      },
    });
    const departments = screen.getByRole("region", { name: "ฝ่ายที่เกี่ยวข้อง" });
    expect(within(departments).getByText("รอข้อมูล")).toBeTruthy();
    expect(within(departments).getByText("ขอ: ขอตารางแข่ง")).toBeTruthy();
    expect(within(departments).queryByRole("button", { name: "แก้คำขอ" })).toBeNull();
    fireEvent.change(within(departments).getByLabelText("คำตอบจากกีฬา"), {
      target: { value: "อัปโหลดในไดรฟ์แล้ว" },
    });
    fireEvent.click(within(departments).getByRole("button", { name: "ส่งคำตอบ" }));
    await waitFor(() => expect(answers).toEqual([["item-1", "d-sports", "อัปโหลดในไดรฟ์แล้ว"]]));
  });

  test("the assignee ticks an action item off with the version they saw", async () => {
    const updates: [string, CalendarActionUpdate][] = [];
    const open = action();
    render(detail({ canEdit: false, actionItems: [open] }), {
      updateActionItem: async (id, json) => {
        updates.push([id, json]);
      },
    });
    const actions = screen.getByRole("region", { name: "Action items" });
    expect(within(actions).queryByLabelText("Action item ใหม่")).toBeNull();
    fireEvent.click(within(actions).getByRole("checkbox"));
    await waitFor(() => expect(updates).toEqual([[open.id, { done: true, version: 3 }]]));
  });

  test("people without rights cannot tick items off", () => {
    render(detail({ canEdit: false, actionItems: [action({ canComplete: false })] }));
    const checkbox = within(screen.getByRole("region", { name: "Action items" })).getByRole(
      "checkbox",
    );
    expect(
      checkbox.getAttribute("aria-disabled") ?? checkbox.getAttribute("data-disabled"),
    ).not.toBeNull();
  });

  test("editors add action items and see what carried over", async () => {
    const added: CalendarActionInput[] = [];
    render(
      detail({
        canEdit: true,
        carriedOver: [action({ title: "ตั้ง OBS", itemTitle: "Weekly sync #1" })],
      }),
      {
        addActionItem: async (_id, json) => {
          added.push(json);
          return action({ title: json.title });
        },
      },
    );
    const carried = screen.getByRole("region", { name: "ค้างจากครั้งก่อน" });
    expect(within(carried).getByText("ตั้ง OBS")).toBeTruthy();
    expect(within(carried).getByText(/จาก Weekly sync #1/)).toBeTruthy();

    const actions = screen.getByRole("region", { name: "Action items" });
    fireEvent.change(within(actions).getByLabelText("Action item ใหม่"), {
      target: { value: "จองห้องซ้อม" },
    });
    fireEvent.click(within(actions).getByRole("button", { name: "เพิ่ม" }));
    await waitFor(() =>
      expect(added).toEqual([
        { title: "จองห้องซ้อม", ownerId: null, departmentId: null, dueAt: null },
      ]),
    );
  });
});
