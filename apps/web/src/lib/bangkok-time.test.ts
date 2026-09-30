import { describe, expect, test } from "bun:test";

import {
  HOUR_MS,
  addMonths,
  bangkokParts,
  bangkokTime,
  dateKey,
  formatBangkok,
  formatRange,
  fromDateKey,
  fromDatetimeLocal,
  monthGrid,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDatetimeLocal,
  portionOnDay,
} from "./bangkok-time";

describe("Bangkok time", () => {
  test("a day starts at 17:00 UTC the evening before", () => {
    // 2026-10-09 17:30 UTC is already 00:30 on the 10th in Bangkok.
    const justAfterMidnight = Date.UTC(2026, 9, 9, 17, 30);
    expect(dateKey(justAfterMidnight)).toBe("2026-10-10");
    expect(startOfDay(justAfterMidnight)).toBe(Date.UTC(2026, 9, 9, 17));
    const justBefore = Date.UTC(2026, 9, 9, 16, 59);
    expect(dateKey(justBefore)).toBe("2026-10-09");
  });

  test("weeks start on Monday", () => {
    // Sunday 2026-10-11, 23:00 Bangkok.
    const sunday = bangkokTime(2026, 9, 11, 23);
    expect(bangkokParts(sunday).weekday).toBe(6);
    expect(dateKey(startOfWeek(sunday))).toBe("2026-10-05");
    expect(bangkokParts(startOfWeek(sunday))).toMatchObject({ weekday: 0, hour: 0 });
  });

  test("month boundaries and grids", () => {
    const lateOnTheLast = bangkokTime(2026, 9, 31, 23, 59);
    expect(dateKey(startOfMonth(lateOnTheLast))).toBe("2026-10-01");
    const grid = monthGrid(lateOnTheLast);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(dateKey(grid[0]?.[0] ?? 0)).toBe("2026-09-28");
    expect(dateKey(grid.at(-1)?.[6] ?? 0)).toBe("2026-11-01");
    expect(dateKey(addMonths(bangkokTime(2026, 0, 31), 1))).toBe("2026-02-28");
  });

  test("datetime-local values round-trip as Bangkok wall time", () => {
    const ms = bangkokTime(2026, 9, 10, 13, 5);
    expect(toDatetimeLocal(ms)).toBe("2026-10-10T13:05");
    expect(fromDatetimeLocal("2026-10-10T13:05")).toBe(ms);
    expect(ms).toBe(Date.UTC(2026, 9, 10, 6, 5));
    expect(fromDatetimeLocal("2026-02-30T10:00")).toBeNull();
    expect(fromDatetimeLocal("")).toBeNull();
  });

  test("date keys reject impossible dates", () => {
    expect(fromDateKey("2026-10-10")).toBe(bangkokTime(2026, 9, 10));
    expect(fromDateKey("2026-13-01")).toBeNull();
    expect(fromDateKey("nope")).toBeNull();
  });

  test("formats in Bangkok time, not the device's zone", () => {
    const ms = Date.UTC(2026, 9, 10, 6, 0);
    expect(formatBangkok(ms, "time")).toBe("13:00");
    expect(formatRange(ms, ms + 2 * HOUR_MS)).toBe("13:00–15:00");
  });
});

describe("portionOnDay", () => {
  const night = {
    startAt: bangkokTime(2026, 9, 10, 23),
    endAt: bangkokTime(2026, 9, 11, 1),
  };

  test("splits an overnight item at Bangkok midnight", () => {
    expect(portionOnDay(night, bangkokTime(2026, 9, 10))).toEqual({
      startAt: bangkokTime(2026, 9, 10, 23),
      endAt: bangkokTime(2026, 9, 11),
      fromBefore: false,
      intoNext: true,
    });
    expect(portionOnDay(night, bangkokTime(2026, 9, 11))).toEqual({
      startAt: bangkokTime(2026, 9, 11),
      endAt: bangkokTime(2026, 9, 11, 1),
      fromBefore: true,
      intoNext: false,
    });
  });

  test("leaves an item inside one day as it is", () => {
    const item = { startAt: bangkokTime(2026, 9, 10, 9), endAt: bangkokTime(2026, 9, 10, 10) };
    expect(portionOnDay(item, bangkokTime(2026, 9, 10))).toEqual({
      ...item,
      fromBefore: false,
      intoNext: false,
    });
  });

  test("an item that ends exactly at midnight does not carry on", () => {
    const late = { startAt: bangkokTime(2026, 9, 10, 22), endAt: bangkokTime(2026, 9, 11) };
    expect(portionOnDay(late, bangkokTime(2026, 9, 10)).intoNext).toBe(false);
    expect(formatRange(late.startAt, late.endAt)).toBe("22:00–00:00");
  });
});
