import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { calendarItem } from "@/test/query";

import { AddToCalendar } from "./add-to-calendar";

afterEach(cleanup);

let opened: string[];
let downloads: { name: string; type: string }[];

beforeEach(() => {
  opened = [];
  downloads = [];
  spyOn(window, "open").mockImplementation(((url: string) => {
    opened.push(url);
    return null;
  }) as typeof window.open);
  spyOn(URL, "createObjectURL").mockImplementation(((blob: Blob) => {
    downloads.push({ name: "", type: blob.type });
    return "blob:test";
  }) as typeof URL.createObjectURL);
  spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      const last = downloads.at(-1);
      if (last) last.name = this.download;
    },
  );
});

async function choose(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: /เพิ่มลงปฏิทิน/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

describe("AddToCalendar", () => {
  test("opens Google Calendar and Outlook with the event filled in", async () => {
    render(<AddToCalendar item={calendarItem({ title: "ซ้อมใหญ่" })} />);
    await choose("Google Calendar");
    await choose("Outlook.com");
    await choose(/Microsoft 365/);
    expect(opened[0]).toStartWith("https://calendar.google.com/calendar/render?");
    expect(opened[1]).toStartWith("https://outlook.live.com/calendar/0/deeplink/compose?");
    expect(opened[2]).toStartWith("https://outlook.office.com/calendar/0/deeplink/compose?");
    for (const url of opened) expect(decodeURIComponent(url)).toContain("ซ้อมใหญ่");
  });

  test("gives Apple Calendar and everything else an .ics file named after the item", async () => {
    render(<AddToCalendar item={calendarItem({ title: "ซ้อมใหญ่" })} />);
    await choose("Apple Calendar");
    await choose("ดาวน์โหลดไฟล์ .ics");
    expect(downloads).toEqual([
      { name: "ซ้อมใหญ่.ics", type: "text/calendar;charset=utf-8" },
      { name: "ซ้อมใหญ่.ics", type: "text/calendar;charset=utf-8" },
    ]);
  });

  test("offers nothing for a cancelled item", () => {
    render(<AddToCalendar item={calendarItem({ status: "cancelled" })} />);
    expect(screen.queryByRole("button", { name: /เพิ่มลงปฏิทิน/ })).toBeNull();
  });
});
