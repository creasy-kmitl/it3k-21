import { describe, expect, test } from "bun:test";

import { calendarItem } from "@/test/query";

import { eventFor, googleCalendarUrl, icsFile, icsFileName, outlookUrl } from "./add-to-calendar";

const START = Date.UTC(2026, 9, 10, 11); // 18:00 Bangkok time
const ORIGIN = "https://it3k.creasy.club";

const item = (overrides = {}) =>
  calendarItem({
    id: "11111111-2222-3333-4444-555555555555",
    title: "ซ้อมพิธีเปิด",
    startAt: START,
    endAt: START + 2 * 60 * 60 * 1000,
    venue: "Hall 1, Floor 2",
    notes: "private: call Somchai 081-000-0000",
    collaborators: [{ id: "d-pr", name: "PR", icon: "megaphone", color: "fuchsia" }],
    updatedAt: START - 1000,
    ...overrides,
  });

describe("eventFor", () => {
  test("carries the title, times, venue, departments and a link back, never the notes", () => {
    const event = eventFor(item(), ORIGIN);
    expect(event).toMatchObject({
      uid: "11111111-2222-3333-4444-555555555555@it3k",
      title: "ซ้อมพิธีเปิด",
      location: "Hall 1, Floor 2",
      url: `${ORIGIN}/staff/calendar?view=day&date=2026-10-10&item=11111111-2222-3333-4444-555555555555`,
    });
    expect(event.details).toContain("แผนก: Art");
    expect(event.details).toContain("ทำงานร่วมกับ: PR");
    expect(event.details).toContain(event.url);
    expect(JSON.stringify(event)).not.toContain("081-000-0000");
  });

  test("marks drafts in the title so a copy is not taken as final", () => {
    expect(eventFor(item({ status: "draft" }), ORIGIN).title).toBe("[ร่าง] ซ้อมพิธีเปิด");
  });
});

describe("links", () => {
  test("Google Calendar gets UTC times and Bangkok as the zone", () => {
    const url = new URL(googleCalendarUrl(eventFor(item(), ORIGIN)));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: "TEMPLATE",
      text: "ซ้อมพิธีเปิด",
      dates: "20261010T110000Z/20261010T130000Z",
      location: "Hall 1, Floor 2",
      ctz: "Asia/Bangkok",
    });
  });

  test("Outlook opens the personal or the work compose page", () => {
    const personal = new URL(outlookUrl(eventFor(item(), ORIGIN), "personal"));
    const work = new URL(outlookUrl(eventFor(item(), ORIGIN), "work"));
    expect(personal.host).toBe("outlook.live.com");
    expect(work.host).toBe("outlook.office.com");
    expect(Object.fromEntries(personal.searchParams)).toMatchObject({
      rru: "addevent",
      subject: "ซ้อมพิธีเปิด",
      startdt: "2026-10-10T11:00:00Z",
      enddt: "2026-10-10T13:00:00Z",
      location: "Hall 1, Floor 2",
    });
  });

  test("an item without a venue sends no location", () => {
    const event = eventFor(item({ venue: null }), ORIGIN);
    expect(new URL(googleCalendarUrl(event)).searchParams.has("location")).toBe(false);
    expect(new URL(outlookUrl(event, "work")).searchParams.has("location")).toBe(false);
    expect(icsFile(event, START)).not.toContain("LOCATION:");
  });
});

describe("icsFile", () => {
  test("is one escaped, folded event keyed by the item", () => {
    const ics = icsFile(eventFor(item({ title: "A, B; C\\D" }), ORIGIN), START);
    expect(ics).toStartWith("BEGIN:VCALENDAR\r\n");
    expect(ics).toEndWith("END:VCALENDAR\r\n");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("UID:11111111-2222-3333-4444-555555555555@it3k\r\n");
    expect(unfolded).toContain("DTSTART:20261010T110000Z\r\n");
    expect(unfolded).toContain("DTEND:20261010T130000Z\r\n");
    expect(unfolded).toContain("SUMMARY:A\\, B\\; C\\\\D\r\n");
    expect(unfolded).toContain("LOCATION:Hall 1\\, Floor 2\r\n");
    expect(unfolded).toContain("DESCRIPTION:แผนก: Art\\nทำงานร่วมกับ: PR\\n");
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("icsFileName", () => {
  test("keeps Thai titles and drops characters file systems refuse", () => {
    expect(icsFileName("ซ้อมพิธีเปิด")).toBe("ซ้อมพิธีเปิด.ics");
    expect(icsFileName('a/b:c*?"<>|d')).toBe("a b c d.ics");
    expect(icsFileName("  ")).toBe("it3k-event.ics");
    expect(icsFileName("a\tb\nc")).toBe("a b c.ics");
    expect(icsFileName("x".repeat(200))).toBe(`${"x".repeat(80)}.ics`);
  });
});
