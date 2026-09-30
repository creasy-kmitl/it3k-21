import { afterEach, describe, expect, test } from "bun:test";
import { TimePicker } from "@it3k/ui/components/time-picker";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

import { defined } from "@/test/query";

afterEach(cleanup);

function Harness({ initial, onValue }: { initial: string; onValue: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimePicker
      aria-label="เวลา"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

const openPopover = () =>
  waitFor(() =>
    defined(document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]')),
  );

describe("TimePicker", () => {
  test("shows a placeholder until a time is set", () => {
    render(<Harness initial="" onValue={() => {}} />);
    expect(screen.getByRole("button", { name: "เวลา" }).textContent).toBe("เลือกเวลา");
  });

  test("marks the current time and closes once the minute is picked", async () => {
    const values: string[] = [];
    render(<Harness initial="18:30" onValue={(value) => values.push(value)} />);
    fireEvent.click(screen.getByRole("button", { name: "เวลา" }));
    const popover = await openPopover();
    const hours = within(popover).getByRole("group", { name: "ชั่วโมง" });
    const minutes = within(popover).getByRole("group", { name: "นาที" });
    expect(within(hours).getByRole("button", { pressed: true }).textContent).toBe("18");
    expect(within(minutes).getAllByRole("button")).toHaveLength(12);

    fireEvent.click(within(hours).getByRole("button", { name: "07" }));
    // Still open after the hour, so the minute can follow.
    expect(document.querySelector('[data-slot="popover-content"][data-open]')).not.toBeNull();
    fireEvent.click(within(minutes).getByRole("button", { name: "45" }));
    expect(values).toEqual(["07:30", "07:45"]);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="popover-content"][data-open]')).toBeNull(),
    );
  });

  test("keeps an off-step minute pickable", async () => {
    render(<Harness initial="09:07" onValue={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "เวลา" }));
    const minutes = within(await openPopover()).getByRole("group", { name: "นาที" });
    expect(within(minutes).getByRole("button", { pressed: true }).textContent).toBe("07");
    expect(within(minutes).getAllByRole("button")).toHaveLength(13);
  });
});
