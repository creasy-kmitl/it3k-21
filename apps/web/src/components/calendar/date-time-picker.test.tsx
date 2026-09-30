import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

import { defined } from "@/test/query";

import { DateTimePicker } from "./date-time-picker";

const originalTz = process.env.TZ;

afterEach(() => {
  cleanup();
  process.env.TZ = originalTz;
});

function Harness({ initial, onValue }: { initial: string; onValue: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="when">เริ่ม</label>
      <DateTimePicker
        id="when"
        label="เริ่ม"
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue(next);
        }}
      />
    </>
  );
}

async function openAndPick(day: number) {
  fireEvent.click(screen.getByRole("button", { name: "เริ่ม" }));
  const popover = await waitFor(() =>
    defined(document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]')),
  );
  const button = [...popover.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === String(day) && !candidate.closest("[data-outside]"),
  );
  fireEvent.click(defined(button, `day ${day}`));
}

describe("DateTimePicker", () => {
  test("picking a day keeps the time, and changing the time keeps the day", async () => {
    const values: string[] = [];
    render(<Harness initial="2026-10-10T18:30" onValue={(v) => values.push(v)} />);
    expect(screen.getByRole("button", { name: "เริ่ม" }).textContent).toContain("10 ต.ค. 2569");
    await openAndPick(12);
    fireEvent.click(screen.getByRole("button", { name: "เวลาเริ่ม 18:30" }));
    const popover = await waitFor(() =>
      defined(document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]')),
    );
    fireEvent.click(
      within(within(popover).getByRole("group", { name: "ชั่วโมง" })).getByRole("button", {
        name: "09",
      }),
    );
    fireEvent.click(
      within(within(popover).getByRole("group", { name: "นาที" })).getByRole("button", {
        name: "05",
      }),
    );
    // The hour applies at once; the minute completes the pick.
    expect(values).toEqual(["2026-10-12T18:30", "2026-10-12T09:30", "2026-10-12T09:05"]);
  });

  test("shows and picks Bangkok days whatever the device's time zone", async () => {
    // 23:30 on the 10th in Bangkok is still the morning of the 10th in LA.
    process.env.TZ = "America/Los_Angeles";
    const values: string[] = [];
    render(<Harness initial="2026-10-10T23:30" onValue={(v) => values.push(v)} />);
    expect(screen.getByRole("button", { name: "เริ่ม" }).textContent).toContain("10 ต.ค. 2569");
    await openAndPick(11);
    expect(values).toEqual(["2026-10-11T23:30"]);
  });
});
