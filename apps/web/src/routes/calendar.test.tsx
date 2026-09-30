import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

import { bangkokTime } from "@/lib/bangkok-time";
import type { PublicCalendarItem } from "@/lib/public-calendar";
import { renderAtRoot } from "@/test/router";

import { PublicCalendar } from "./calendar";

afterEach(cleanup);

const NOW = bangkokTime(2026, 9, 10, 12);

const SPORTS = { id: "d-sports", name: "กีฬา", icon: "trophy", color: "green" } as const;
const ART = { id: "d-art", name: "Art", icon: "palette", color: "rose" } as const;

function item(overrides: Partial<PublicCalendarItem> = {}): PublicCalendarItem {
  return {
    id: crypto.randomUUID(),
    title: "พิธีเปิด",
    startAt: bangkokTime(2026, 9, 10, 18),
    endAt: bangkokTime(2026, 9, 10, 20),
    venue: "Hall 1",
    department: SPORTS,
    updatedAt: NOW,
    ...overrides,
  };
}

const FEED = "https://it3k-api.creasy.club/api/public/calendar/calendar.ics";

function render(items: PublicCalendarItem[]) {
  return renderAtRoot(() => <PublicCalendar items={items} now={NOW} feedUrl={FEED} />);
}

describe("/calendar", () => {
  test("lists published items by Bangkok day with their department and venue", async () => {
    await render([
      item(),
      item({ title: "นิทรรศการ", department: ART, startAt: bangkokTime(2026, 9, 10, 13) }),
      item({
        title: "ซ้อมเชียร์",
        startAt: bangkokTime(2026, 9, 11, 10),
        endAt: bangkokTime(2026, 9, 11, 11),
      }),
    ]);
    const today = screen.getByRole("region", { name: /10 ตุลาคม/ });
    const rows = within(today)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual([expect.stringContaining("นิทรรศการ"), expect.stringContaining("พิธีเปิด")]);
    expect(rows[0]).toContain("Art");
    expect(rows[1]).toContain("Hall 1");
    expect(screen.getByRole("region", { name: /11 ตุลาคม/ }).textContent).toContain("ซ้อมเชียร์");
  });

  test("filters by department and offers the subscription feed", async () => {
    await render([item(), item({ title: "นิทรรศการ", department: ART })]);
    fireEvent.click(screen.getByRole("button", { name: "Art" }));
    expect(screen.queryByText("พิธีเปิด")).toBeNull();
    expect(screen.getByText("นิทรรศการ")).toBeTruthy();
    expect(screen.getByRole("link", { name: "เพิ่มลงปฏิทินของฉัน" }).getAttribute("href")).toBe(
      "webcal://it3k-api.creasy.club/api/public/calendar/calendar.ics",
    );
  });

  test("says so when nothing is published", async () => {
    await render([]);
    expect(screen.getByText("ยังไม่มีรายการที่ประกาศในช่วงนี้")).toBeTruthy();
  });
});
