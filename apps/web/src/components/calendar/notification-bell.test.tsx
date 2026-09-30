import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { bangkokTime } from "@/lib/bangkok-time";
import type { CalendarInbox } from "@/lib/calendar";
import { describeNotification } from "@/lib/calendar-labels";

import { isImportantChange } from "./item-sheet";
import { NotificationList } from "./notification-bell";

afterEach(cleanup);

const AT = bangkokTime(2026, 9, 10, 18);

function inbox(overrides: Partial<CalendarInbox> = {}): CalendarInbox {
  return {
    items: [
      {
        id: "n1",
        itemId: "item-1",
        kind: "reschedule",
        itemTitle: "VALORANT SF",
        data: { startAt: AT, reason: "ทีมขอเลื่อน" },
        createdAt: AT - 3_600_000,
        readAt: null,
      },
      {
        id: "n2",
        itemId: "item-2",
        kind: "action_item",
        itemTitle: "ประชุมข้ามฝ่าย",
        data: { title: "ส่งรายชื่อทีม", dueAt: null },
        createdAt: AT - 7_200_000,
        readAt: AT,
      },
    ],
    unread: 1,
    attention: [
      {
        kind: "readiness",
        itemId: "item-3",
        itemTitle: "RoV Final",
        startAt: AT,
        checklistDone: 5,
        hasOnCall: false,
      },
    ],
    ...overrides,
  };
}

describe("NotificationList", () => {
  test("puts what needs attention first and words each notice in Thai", () => {
    render(<NotificationList inbox={inbox()} onOpen={() => {}} onReadAll={() => {}} />);
    const urgent = screen.getByRole("region", { name: "ต้องดูตอนนี้" });
    expect(urgent.textContent).toContain('"RoV Final"');
    expect(urgent.textContent).toContain("checklist 5/7, ยังไม่มี on-call");
    const notices = screen.getByRole("region", { name: "การแจ้งเตือน" });
    expect(notices.textContent).toContain('"VALORANT SF" ถูกเลื่อนเป็น');
    expect(notices.textContent).toContain("(เหตุผล: ทีมขอเลื่อน)");
    expect(within(notices).getAllByText("ยังไม่อ่าน")).toHaveLength(1);
  });

  test("opens the item and marks only unread notices read", () => {
    const opened: unknown[] = [];
    let readAll = 0;
    render(
      <NotificationList
        inbox={inbox()}
        onOpen={(target) => opened.push(target)}
        onReadAll={() => readAll++}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /VALORANT SF/ }));
    fireEvent.click(screen.getByRole("button", { name: /ส่งรายชื่อทีม/ }));
    fireEvent.click(screen.getByRole("button", { name: "อ่านทั้งหมด" }));
    expect(opened).toEqual([
      { itemId: "item-1", notificationId: "n1", startAt: AT },
      { itemId: "item-2", notificationId: undefined, startAt: undefined },
    ]);
    expect(readAll).toBe(1);
  });
});

describe("describeNotification", () => {
  test("covers each kind", () => {
    const say = (kind: string, data: Record<string, unknown> = {}) =>
      describeNotification({ kind, itemTitle: "X", data });
    expect(say("assignment", { role: "onCallOwnerId" })).toBe('คุณเป็นon-callของ "X"');
    expect(say("cancel", { reason: "ฝนตก" })).toBe('"X" ถูกยกเลิก (เหตุผล: ฝนตก)');
    expect(say("dependency", { change: "cancel" })).toBe('"X" ที่งานของคุณรออยู่ถูกยกเลิก');
    expect(say("request", { department: "กีฬา", request: "ขอตาราง" })).toBe(
      'ฝ่ายกีฬาถูกขอข้อมูลใน "X": ขอตาราง',
    );
    expect(say("release_risk", { approvalWithdrawn: true })).toBe(
      'การอนุมัติ release "X" ถูกถอน เพราะแผนเปลี่ยน',
    );
  });
});

describe("isImportantChange", () => {
  test("flags changes to times, people, venues, streams and releases", () => {
    expect(isImportantChange({ action: "reschedule", changes: {} })).toBe(true);
    expect(isImportantChange({ action: "update", changes: { venue: ["A", "B"] } })).toBe(true);
    expect(isImportantChange({ action: "status", changes: { status: ["ready", "live"] } })).toBe(
      true,
    );
    expect(isImportantChange({ action: "update", changes: { title: ["A", "B"] } })).toBe(false);
  });
});
