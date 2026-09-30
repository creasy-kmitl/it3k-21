import { describe, expect, test } from "bun:test";

import { HOUR_MS } from "@/lib/bangkok-time";
import { CALENDAR_NOW as NOW, calendarItem } from "@/test/query";

import { summarize } from "./run-sheet";

const at = (hours: number, length = 1) => ({
  startAt: NOW + hours * HOUR_MS,
  endAt: NOW + (hours + length) * HOUR_MS,
});

describe("summarize", () => {
  test("finds what is live now and what comes next", () => {
    const live = calendarItem({ title: "live", ...at(-1, 2) });
    const nextMatch = calendarItem({ title: "next match", ...at(2) });
    const laterMatch = calendarItem({ title: "later match", ...at(5) });
    const meeting = calendarItem({
      title: "sync",
      mode: "meetings",
      category: "planning",
      ...at(1),
    });
    const release = calendarItem({
      title: "release",
      mode: "delivery",
      category: "release",
      status: "planned",
      ...at(3),
    });
    const summary = summarize([laterMatch, release, meeting, nextMatch, live], NOW);
    expect(summary.liveNow.map((item) => item.title)).toEqual(["live"]);
    expect(summary.nextLive?.title).toBe("next match");
    expect(summary.nextMeeting?.title).toBe("sync");
    expect(summary.nextRelease?.title).toBe("release");
  });

  test("skips cancelled and archived items and lists open blockers", () => {
    const cancelled = calendarItem({ status: "cancelled", ...at(1) });
    const archived = calendarItem({ archivedAt: NOW, ...at(1) });
    const blocked = calendarItem({ title: "blocked", blockedReason: "รอสาย LAN", ...at(4) });
    const risky = calendarItem({ title: "risky", riskLevel: "high", ...at(6) });
    const over = calendarItem({ blockedReason: "จบไปแล้ว", ...at(-5) });
    const summary = summarize([cancelled, archived, blocked, risky, over], NOW);
    expect(summary.nextLive?.title).toBe("blocked");
    expect(summary.blockers.map((item) => item.title)).toEqual(["blocked", "risky"]);
  });
});
