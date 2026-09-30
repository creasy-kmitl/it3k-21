import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CalendarQuery } from "@/lib/calendar";
import { CALENDAR_NOW, calendarItem, fakeApi, fakeCalendarApi, fakeUsersApi } from "@/test/query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderAtRoot } from "@/test/router";

import { Upcoming, upcoming } from "./upcoming";

afterEach(cleanup);

const HOUR = 60 * 60 * 1000;

describe("upcoming", () => {
  test("keeps what is on now or next, soonest first, at most five, without cancellations", () => {
    const now = CALENDAR_NOW;
    const at = (hours: number, overrides = {}) =>
      calendarItem({
        title: `+${hours}`,
        startAt: now + hours * HOUR,
        endAt: now + (hours + 1) * HOUR,
        ...overrides,
      });
    const items = [
      at(5),
      at(-3), // ended
      at(-0.5, { title: "now" }),
      at(1, { status: "cancelled" }),
      at(2),
      at(3),
      at(4),
      at(6),
    ];
    expect(upcoming(items, now).map((item) => item.title)).toEqual(["now", "+2", "+3", "+4", "+5"]);
  });
});

describe("<Upcoming />", () => {
  async function show(departmentId: string | null, items = [calendarItem({ title: "ซ้อมใหญ่" })]) {
    const queries: CalendarQuery[] = [];
    const calendar = fakeCalendarApi({
      list: async (query) => {
        queries.push(query);
        return {
          items,
          truncated: false,
          canCreate: true,
          myDepartmentId: departmentId,
          isAdmin: false,
        };
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderAtRoot(() => (
      <QueryClientProvider client={client}>
        <ApiProvider value={{ calendar, leadership: fakeApi(), users: fakeUsersApi() }}>
          <Upcoming now={CALENDAR_NOW} departmentId={departmentId} />
        </ApiProvider>
      </QueryClientProvider>
    ));
    return queries;
  }

  test("looks a week ahead in the viewer's department and links into the calendar", async () => {
    const queries = await show("d-art");
    const section = await screen.findByRole("region", { name: "กำหนดการของแผนกใน 7 วัน" });
    const link = await within(section).findByRole("link", { name: /ซ้อมใหญ่/ });
    expect(link.getAttribute("href")).toContain("/staff/calendar?");
    expect(link.getAttribute("href")).toContain("view=day");
    expect(queries[0]?.departmentIds).toEqual(["d-art"]);
    expect((queries[0]?.to ?? 0) - (queries[0]?.from ?? 0)).toBe(7 * 24 * HOUR);
  });

  test("without a department it looks at every department", async () => {
    const queries = await show(null, []);
    expect(await screen.findByText("ยังไม่มีรายการ")).toBeTruthy();
    expect(screen.getByRole("region", { name: "กำหนดการใน 7 วัน" })).toBeTruthy();
    expect(queries[0]?.departmentIds).toBeUndefined();
  });
});
