import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { bangkokTime } from "@/lib/bangkok-time";
import { calendarItem } from "@/test/query";

import { ItemChip } from "./item-chip";

afterEach(cleanup);

const TECH = { id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" } as const;
const PR = { id: "d-pr", name: "PR", icon: "megaphone", color: "fuchsia" } as const;

describe("ItemChip", () => {
  test("shows the title, department and how many departments work on it too", () => {
    const item = calendarItem({ title: "ซ้อมใหญ่", collaborators: [TECH, PR] });
    render(<ItemChip item={item} onSelect={() => {}} />);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toContain("ซ้อมใหญ่");
    expect(chip.textContent).toContain("Art +2");
    expect(chip.getAttribute("aria-label")).toContain("ร่วมกับ Tech/Live, PR");
    // The department's colour, not a fixed one.
    expect(chip.className).toContain("bg-rose-500/15");
  });

  test("marks drafts and cancellations", () => {
    render(
      <>
        <ItemChip item={calendarItem({ title: "ร่าง", status: "draft" })} onSelect={() => {}} />
        <ItemChip
          item={calendarItem({ title: "ยกเลิก", status: "cancelled" })}
          onSelect={() => {}}
        />
      </>,
    );
    const draft = screen.getByRole("button", { name: /^ร่าง/ });
    expect(draft.className).toContain("border-dashed");
    expect(draft.getAttribute("aria-label")).toContain("(ร่าง)");
    expect(screen.getByRole("button", { name: /^ยกเลิก/ }).className).toContain("line-through");
  });

  test("hides the time when asked and reports the chosen item", () => {
    const item = calendarItem();
    const chosen: string[] = [];
    render(<ItemChip item={item} onSelect={(picked) => chosen.push(picked.id)} showTime={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect(chosen).toEqual([item.id]);
    expect(screen.getByRole("button").textContent).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe("ItemChip on one day of an overnight item", () => {
  const night = calendarItem({
    title: "ถ่ายทอดสดรอบดึก",
    startAt: bangkokTime(2026, 9, 10, 23),
    endAt: bangkokTime(2026, 9, 11, 1),
  });

  test("shows the start on its first day and says it carries on", () => {
    render(<ItemChip item={night} day={bangkokTime(2026, 9, 10)} onSelect={() => {}} />);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toContain("23:00");
    expect(chip.getAttribute("aria-label")).toContain("23:00–00:00 (ต่อถึงวันถัดไป)");
    expect(chip.querySelector(".lucide-chevron-right")).not.toBeNull();
  });

  test("shows midnight on the next day, not the previous day's start", () => {
    render(<ItemChip item={night} day={bangkokTime(2026, 9, 11)} onSelect={() => {}} />);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toContain("00:00");
    expect(chip.textContent).not.toContain("23:00");
    expect(chip.getAttribute("aria-label")).toContain("00:00–01:00 (ต่อจากวันก่อน)");
    expect(chip.querySelector(".lucide-chevron-left")).not.toBeNull();
  });
});
