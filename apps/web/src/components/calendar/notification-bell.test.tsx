import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { bangkokTime } from "@/lib/bangkok-time";
import type { CalendarInbox } from "@/lib/calendar";
import { describeNotification } from "@/lib/calendar-labels";

import { isImportantChange } from "./item-sheet";
import { ApiProvider } from "@/lib/api-context";
import { fakeApi, fakeCalendarApi, fakeUsersApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { NotificationBell, NotificationList } from "./notification-bell";

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
    nextCursor: null,
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

describe("older notices", () => {
  test("offers the next page while there is one, and says when it is loading", () => {
    let loads = 0;
    const { rerender } = render(
      <NotificationList
        inbox={inbox()}
        onOpen={() => {}}
        onReadAll={() => {}}
        hasMore
        onLoadMore={() => loads++}
      />,
    );
    const more = screen.getByRole("button", { name: "โหลดการแจ้งเตือนเก่ากว่านี้" });
    fireEvent.click(more);
    expect(loads).toBe(1);
    rerender(
      <NotificationList
        inbox={inbox()}
        onOpen={() => {}}
        onReadAll={() => {}}
        hasMore
        loadingMore
        onLoadMore={() => loads++}
      />,
    );
    // The spinner adds its own label while loading.
    expect(
      screen.getByRole("button", { name: /โหลดการแจ้งเตือนเก่ากว่านี้/ }).hasAttribute("disabled"),
    ).toBe(true);
    rerender(<NotificationList inbox={inbox()} onOpen={() => {}} onReadAll={() => {}} />);
    expect(screen.queryByRole("button", { name: "โหลดการแจ้งเตือนเก่ากว่านี้" })).toBeNull();
  });
});

describe("<NotificationBell />", () => {
  test("loads older pages until the old unread notice can be opened", async () => {
    const notice = (id: string, readAt: number | null) => ({
      id,
      itemId: `item-${id}`,
      kind: "assignment" as const,
      itemTitle: `งาน ${id}`,
      data: {},
      createdAt: AT,
      readAt,
    });
    const cursors: (string | undefined)[] = [];
    const calendar = fakeCalendarApi({
      notifications: async (cursor) => {
        cursors.push(cursor);
        return cursor
          ? { items: [notice("old", null)], unread: 1, nextCursor: null }
          : { items: [notice("new", AT)], unread: 1, nextCursor: "123.4" };
      },
    });
    await renderAtRoot(() => (
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider value={{ calendar, leadership: fakeApi(), users: fakeUsersApi() }}>
          <NotificationBell />
        </ApiProvider>
      </QueryClientProvider>
    ));
    fireEvent.click(await screen.findByRole("button", { name: "การแจ้งเตือน 1 รายการใหม่" }));
    const inboxPanel = await screen.findByRole("region", { name: "การแจ้งเตือน" });
    expect(inboxPanel.textContent).toContain("งาน new");
    expect(inboxPanel.textContent).not.toContain("งาน old");
    fireEvent.click(within(inboxPanel).getByRole("button", { name: "โหลดการแจ้งเตือนเก่ากว่านี้" }));
    await waitFor(() => expect(inboxPanel.textContent).toContain("งาน old"));
    expect(cursors).toEqual([undefined, "123.4"]);
    expect(within(inboxPanel).getAllByText("ยังไม่อ่าน")).toHaveLength(1);
    expect(within(inboxPanel).queryByRole("button", { name: "โหลดการแจ้งเตือนเก่ากว่านี้" })).toBeNull();
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
