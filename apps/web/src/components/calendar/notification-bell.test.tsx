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
        itemTitle: "ซ้อมพิธีเปิด",
        data: { startAt: AT, reason: "สนามไม่ว่าง" },
        createdAt: AT - 3_600_000,
        readAt: null,
      },
      {
        id: "n2",
        itemId: "item-2",
        kind: "assignment",
        itemTitle: "ประชุมฝ่ายศิลป์",
        data: {},
        createdAt: AT - 7_200_000,
        readAt: AT,
      },
    ],
    unread: 1,
    ...overrides,
  };
}

describe("NotificationList", () => {
  test("words each notice in Thai and marks the unread ones", () => {
    render(<NotificationList inbox={inbox()} onOpen={() => {}} onReadAll={() => {}} />);
    const notices = screen.getByRole("region", { name: "การแจ้งเตือน" });
    expect(notices.textContent).toContain('"ซ้อมพิธีเปิด" ถูกเลื่อนเป็น');
    expect(notices.textContent).toContain("(เหตุผล: สนามไม่ว่าง)");
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
    fireEvent.click(screen.getByRole("button", { name: /ซ้อมพิธีเปิด/ }));
    fireEvent.click(screen.getByRole("button", { name: /ประชุมฝ่ายศิลป์/ }));
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
    expect(say("assignment")).toBe('คุณเป็นผู้รับผิดชอบ "X"');
    expect(say("cancel", { reason: "ฝนตก" })).toBe('"X" ถูกยกเลิก (เหตุผล: ฝนตก)');
    expect(say("reschedule")).toBe('"X" ถูกเลื่อนเป็น เวลาใหม่');
    expect(say("collaboration", { department: "ทะเบียน" })).toBe(
      'ฝ่ายทะเบียนถูกเพิ่มเป็นฝ่ายที่ทำงานร่วมกันใน "X"',
    );
    // Kinds from before the calendar was simplified still read as the title.
    expect(say("release_risk")).toBe("X");
  });
});

describe("isImportantChange", () => {
  test("flags moves, cancellations and handovers", () => {
    expect(isImportantChange({ action: "reschedule", changes: {} })).toBe(true);
    expect(isImportantChange({ action: "cancel", changes: {} })).toBe(true);
    expect(isImportantChange({ action: "update", changes: { ownerId: ["a", "b"] } })).toBe(true);
    expect(isImportantChange({ action: "update", changes: { title: ["A", "B"] } })).toBe(false);
  });
});
