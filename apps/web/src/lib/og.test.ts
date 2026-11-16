import { describe, expect, test } from "bun:test";

import { type PublicEvent, absoluteImage, eventOg, eventsOg, previewTarget } from "./og";

const API = "https://api.test/api/public/events";

const opening: PublicEvent = {
  id: "e-1",
  slug: "opening",
  name: "พิธีเปิด",
  description: "ขบวนพาเหรด และการแสดง",
  // 09:00–12:00 in Bangkok.
  startAt: new Date(Date.UTC(2026, 11, 5, 2)).toISOString(),
  endAt: new Date(Date.UTC(2026, 11, 5, 5)).toISOString(),
  thumbnailUrl: "https://files.test/cover.png",
  venue: "หอประชุม",
};

describe("previewTarget", () => {
  test("knows the shared pages", () => {
    expect(previewTarget("/events")).toEqual({ kind: "events" });
    expect(previewTarget("/events/")).toEqual({ kind: "events" });
    expect(previewTarget("/events/opening")).toEqual({ kind: "event", ref: "opening" });
    expect(previewTarget("/tickets/opening")).toEqual({ kind: "ticket", ref: "opening" });
    expect(previewTarget("/events/%E0%B8%81")).toEqual({ kind: "event", ref: "ก" });
  });

  test("leaves every other page to the site preview", () => {
    expect(previewTarget("/")).toBeNull();
    expect(previewTarget("/me/tickets")).toBeNull();
    expect(previewTarget("/events/a/b")).toBeNull();
    expect(previewTarget("/events/%E0%A4")).toBeNull();
  });
});

describe("absoluteImage", () => {
  test("keeps web URLs, resolves relative ones and drops the rest", () => {
    expect(absoluteImage("https://files.test/a.png", API)).toBe("https://files.test/a.png");
    expect(absoluteImage("/api/files/public/x", API)).toBe("https://api.test/api/files/public/x");
    expect(absoluteImage("javascript:alert(1)", API)).toBeNull();
    expect(absoluteImage(null, API)).toBeNull();
  });
});

describe("eventOg", () => {
  test("an event leads with when and where, then its description", () => {
    const og = eventOg(opening, "event", API);
    expect(og.title).toBe("พิธีเปิด");
    expect(og.description).toContain("09:00–12:00 น.");
    expect(og.description).toContain(" · หอประชุม — ขบวนพาเหรด และการแสดง");
    expect(og.image).toBe("https://files.test/cover.png");
  });

  test("a ticket says it is one, without the event's description", () => {
    const og = eventOg({ ...opening, venue: null, thumbnailUrl: null }, "ticket", API);
    expect(og.title).toBe("ตั๋ว พิธีเปิด");
    expect(og.description.startsWith("ตั๋วเข้างาน · ")).toBe(true);
    expect(og.description).not.toContain("ขบวนพาเหรด");
    expect(og.image).toBeNull();
  });
});

describe("eventsOg", () => {
  test("names the soonest events and uses the first cover there is", () => {
    const og = eventsOg(
      {
        total: 5,
        items: [
          { name: "ฟุตบอล", thumbnailUrl: null },
          { name: "พิธีเปิด", thumbnailUrl: "https://files.test/cover.png" },
        ],
      },
      API,
    );
    expect(og.description).toBe("เปิดรับตั๋ว 5 กิจกรรม: ฟุตบอล, พิธีเปิด และอื่น ๆ");
    expect(og.image).toBe("https://files.test/cover.png");
  });

  test("still reads well when nothing is open", () => {
    const og = eventsOg({ total: 0, items: [] }, API);
    expect(og.description).toContain("รับตั๋วกิจกรรม");
    expect(og.image).toBeNull();
  });
});
