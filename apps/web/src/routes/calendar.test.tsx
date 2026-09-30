import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

import { bangkokTime } from "@/lib/bangkok-time";
import type { PublicCalendarItem } from "@/lib/public-calendar";
import { renderAtRoot } from "@/test/router";

import { PublicCalendar } from "./calendar";

afterEach(cleanup);

const NOW = bangkokTime(2026, 9, 10, 12);

function item(overrides: Partial<PublicCalendarItem> = {}): PublicCalendarItem {
  return {
    id: crypto.randomUUID(),
    title: "VALORANT Final",
    category: "match",
    status: "scheduled",
    startAt: bangkokTime(2026, 9, 10, 18),
    endAt: bangkokTime(2026, 9, 10, 20),
    game: "valorant",
    matchId: "VAL-F",
    teams: ["KMITL", "KMUTT"],
    venue: "Hall 1",
    streamPlatform: "YouTube",
    scoreboardUrl: "https://score.example/val",
    updatedAt: NOW,
    ...overrides,
  };
}

const FEED = "https://it3k-api.creasy.club/api/public/calendar/calendar.ics";

function render(items: PublicCalendarItem[]) {
  return renderAtRoot(() => <PublicCalendar items={items} now={NOW} feedUrl={FEED} />);
}

describe("/calendar", () => {
  test("lists published items by Bangkok day, with live and cancelled marked", async () => {
    await render([
      item(),
      item({ title: "RoV SF", game: "rov", status: "live", startAt: bangkokTime(2026, 9, 10, 13) }),
      item({
        title: "TFT R1",
        game: "tft",
        status: "cancelled",
        startAt: bangkokTime(2026, 9, 11, 10),
        endAt: bangkokTime(2026, 9, 11, 11),
      }),
    ]);
    const today = screen.getByRole("region", { name: /10 ตุลาคม/ });
    expect(
      within(today)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining("RoV SF"), expect.stringContaining("VALORANT Final")]);
    expect(within(today).getByText("Live")).toBeTruthy();
    expect(within(today).getAllByText(/KMITL vs KMUTT/)).toHaveLength(2);
    const tomorrow = screen.getByRole("region", { name: /11 ตุลาคม/ });
    expect(within(tomorrow).getByText("ยกเลิก")).toBeTruthy();
  });

  test("filters by game and offers the subscription feed", async () => {
    await render([item(), item({ title: "RoV SF", game: "rov" })]);
    fireEvent.click(screen.getByRole("button", { name: "RoV" }));
    expect(screen.queryByText("VALORANT Final")).toBeNull();
    expect(screen.getByText("RoV SF")).toBeTruthy();
    expect(screen.getByRole("link", { name: "เพิ่มลงปฏิทินของฉัน" }).getAttribute("href")).toBe(
      "webcal://it3k-api.creasy.club/api/public/calendar/calendar.ics",
    );
  });

  test("says so when nothing is published", async () => {
    await render([]);
    expect(screen.getByText("ยังไม่มีรายการที่ประกาศในช่วงนี้")).toBeTruthy();
  });
});
