import { describe, expect, test } from "bun:test";

import { EVENT_END_DATES, purgeCutoff, purgeDueAt, seasonEnd } from "./retention";

describe("retention dates", () => {
  test("a season ends at the last moment of the Bangkok day", () => {
    expect(seasonEnd("2026-12-26").toISOString()).toBe("2026-12-26T16:59:59.999Z");
  });

  test("a season is purged at Bangkok midnight one year later", () => {
    expect(purgeDueAt("2026-12-26").toISOString()).toBe("2027-12-25T17:00:00.000Z");
  });

  test("the cutoff is the latest season whose purge date has passed", () => {
    const dates = ["2025-12-20", "2026-12-26"];
    expect(purgeCutoff(new Date("2026-12-19T16:59:59Z"), dates)).toBeNull();
    expect(purgeCutoff(new Date("2026-12-20T00:00:00Z"), dates)?.toISOString()).toBe(
      "2025-12-20T16:59:59.999Z",
    );
    expect(purgeCutoff(new Date("2028-01-01T00:00:00Z"), dates)?.toISOString()).toBe(
      "2026-12-26T16:59:59.999Z",
    );
  });

  test("refuses dates it cannot purge on", () => {
    expect(() => seasonEnd("26/12/2026")).toThrow();
    expect(() => seasonEnd("2026-02-30")).toThrow();
    expect(() => purgeDueAt("2028-02-29")).toThrow();
  });

  test("every listed event date is usable, oldest first", () => {
    for (const date of EVENT_END_DATES) expect(() => purgeDueAt(date)).not.toThrow();
    expect([...EVENT_END_DATES].sort()).toEqual([...EVENT_END_DATES]);
  });
});
