import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CalendarApi, CalendarItemDetail, CalendarUpdate } from "@/lib/calendar";
import {
  CALENDAR_NOW,
  calendarItem,
  fakeApi,
  fakeCalendarApi,
  fakeUsersApi,
  renderWithQuery,
} from "@/test/query";

import { DeliveryPanel } from "./delivery-panel";

afterEach(cleanup);

function release(overrides: Partial<CalendarItemDetail> = {}): CalendarItemDetail {
  return {
    ...calendarItem({
      id: "release-1",
      title: "Scoreboard v2",
      mode: "delivery",
      category: "release",
      status: "ready_to_release",
      environment: "prod",
      qaResult: "passed",
      rollbackPlan: "Revert to v1",
      version: 4,
    }),
    departments: [],
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
      <DeliveryPanel item={item} />
    </ApiProvider>,
  );
}

describe("DeliveryPanel", () => {
  test("lists what the release still lacks", () => {
    render(release());
    const gates = screen.getByRole("region", { name: "ก่อนปล่อย release" });
    const passed = within(gates).getAllByLabelText("ผ่าน").length;
    const missing = within(gates).getAllByLabelText("ยังไม่ผ่าน").length;
    // Environment, QA, rollback and dependencies pass; approval and monitoring do not.
    expect([passed, missing]).toEqual([4, 2]);
    expect(within(gates).queryByRole("button", { name: "อนุมัติ release" })).toBeNull();
  });

  test("approvers approve the plan they are looking at", async () => {
    const updates: [string, CalendarUpdate][] = [];
    render(release({ canApprove: true }), {
      update: async (id, json) => {
        updates.push([id, json]);
        return calendarItem();
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ release" }));
    await waitFor(() =>
      expect(updates).toEqual([["release-1", { releaseApproved: true, version: 4 }]]),
    );
  });

  test("editors pick an item to wait on and say what slips", async () => {
    const added: [string, string, string | null][] = [];
    render(release({ canEdit: true }), {
      search: async () => ({
        items: [
          {
            id: "qa-1",
            title: "QA scoreboard",
            status: "qa",
            category: "qa",
            startAt: CALENDAR_NOW,
          },
        ],
      }),
      addDependency: async (id, dependsOnId, impact) => {
        added.push([id, dependsOnId, impact]);
      },
    });
    const section = screen.getByRole("region", { name: "รอรายการ" });
    fireEvent.change(within(section).getByLabelText("ค้นหารายการที่ต้องรอ"), {
      target: { value: "QA" },
    });
    fireEvent.click(await within(section).findByRole("button", { name: /QA scoreboard/ }));
    fireEvent.change(within(section).getByLabelText("ผลกระทบถ้าล่าช้า"), {
      target: { value: "release window 16:00" },
    });
    fireEvent.click(within(section).getByRole("button", { name: "เพิ่ม dependency" }));
    await waitFor(() => expect(added).toEqual([["release-1", "qa-1", "release window 16:00"]]));
  });

  test("shows unfinished dependencies and lets editors drop them", async () => {
    const removed: string[] = [];
    render(
      release({
        canEdit: true,
        waitingOn: 1,
        dependsOn: [
          {
            id: "dep-1",
            impact: "stream slot 18:00",
            satisfied: false,
            item: {
              id: "qa-1",
              title: "QA scoreboard",
              status: "qa",
              category: "qa",
              startAt: CALENDAR_NOW,
              owner: "Tech Staff",
            },
          },
        ],
      }),
      {
        removeDependency: async (id) => {
          removed.push(id);
        },
      },
    );
    const section = screen.getByRole("region", { name: "รอรายการ" });
    expect(within(section).getByText("ยังไม่เสร็จ")).toBeTruthy();
    expect(within(section).getByText("ผลกระทบ: stream slot 18:00")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "เลิกรอ QA scoreboard" }));
    await waitFor(() => expect(removed).toEqual(["dep-1"]));
  });
});
