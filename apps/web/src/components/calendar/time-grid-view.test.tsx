import { describe, expect, test } from "bun:test";

import { bangkokTime } from "@/lib/bangkok-time";
import { calendarItem } from "@/test/query";

import { layoutDay } from "./time-grid-view";

const DAY = bangkokTime(2026, 9, 10);
const MINUTE = 60 * 1000;

const at = (title: string, hour: number, minute: number, minutes: number) => {
  const startAt = bangkokTime(2026, 9, 10, hour, minute);
  return calendarItem({ title, startAt, endAt: startAt + minutes * MINUTE });
};

const lanes = (items: ReturnType<typeof at>[]) =>
  layoutDay(items, DAY).map((entry) => [entry.item.title, entry.lane, entry.lanes]);

/** Whether two placed chips cover any of the same pixels in the same lane. */
function overlapping(items: ReturnType<typeof at>[]) {
  const placed = layoutDay(items, DAY);
  return placed.some((a, i) =>
    placed.some(
      (b, j) => i < j && a.lane === b.lane && a.top < b.top + b.height && b.top < a.top + a.height,
    ),
  );
}

describe("layoutDay", () => {
  test("gives back-to-back five-minute items their own lanes, as drawn", () => {
    const items = [at("A", 9, 0, 5), at("B", 9, 5, 5), at("C", 9, 10, 5)];
    // Each is drawn 22px tall though it lasts only 4px of the grid.
    expect(overlapping(items)).toBe(false);
    expect(lanes(items)).toEqual([
      ["A", 0, 3],
      ["B", 1, 3],
      ["C", 2, 3],
    ]);
  });

  test("reuses a lane once the drawn chip above has ended", () => {
    // A 5-minute chip is drawn 22px, about 27.5 minutes, so 09:30 fits under it.
    const items = [at("A", 9, 0, 5), at("B", 9, 5, 5), at("C", 9, 30, 30)];
    expect(overlapping(items)).toBe(false);
    expect(lanes(items)).toEqual([
      ["A", 0, 2],
      ["B", 1, 2],
      ["C", 0, 2],
    ]);
  });

  test("lays out items that do not touch in one full-width lane", () => {
    const items = [at("A", 9, 0, 60), at("B", 10, 0, 60), at("C", 13, 0, 5)];
    expect(lanes(items)).toEqual([
      ["A", 0, 1],
      ["B", 0, 1],
      ["C", 0, 1],
    ]);
  });

  test("puts truly overlapping items side by side", () => {
    const items = [at("A", 9, 0, 120), at("B", 10, 0, 60), at("C", 10, 30, 60)];
    expect(overlapping(items)).toBe(false);
    expect(lanes(items).map(([, lane]) => lane)).toEqual([0, 1, 2]);
  });

  test("clips an overnight item to the day", () => {
    const night = calendarItem({
      startAt: bangkokTime(2026, 9, 9, 23),
      endAt: bangkokTime(2026, 9, 10, 1),
    });
    const [entry] = layoutDay([night], DAY);
    expect(entry).toMatchObject({ top: 0, height: 48 });
  });
});
