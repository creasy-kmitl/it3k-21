import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
