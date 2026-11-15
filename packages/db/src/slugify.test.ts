import { describe, expect, test } from "bun:test";

import { EVENT_SLUG_MAX, eventSlug, eventSlugBase, firstFreeSlug } from "./event-rules";
import { slugify } from "./slugify";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("IT3K Football Round 1")).toBe("it3k-football-round-1");
    expect(slugify("  Opening   Day  ")).toBe("opening-day");
  });

  test("strips punctuation and collapses repeated hyphens", () => {
    expect(slugify("Final!!! (Men's) -- 3x3")).toBe("final-mens-3x3");
    expect(slugify("a__b..c//d")).toBe("a-b-c-d");
    expect(slugify("---a---b---")).toBe("a-b");
    expect(slugify("It’s on")).toBe("its-on");
  });

  test("drops accents and folds full-width letters", () => {
    expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
    expect(slugify("ＩＴ３Ｋ")).toBe("it3k");
  });

  test("keeps the Latin letters and digits of a Thai name, Thai digits included", () => {
    expect(slugify("ฟุตบอล IT3K รอบ ๒")).toBe("it3k-2");
    expect(slugify("กีฬาสี 2569")).toBe("2569");
    expect(slugify("พิธีเปิด")).toBe("");
    expect(slugify("")).toBe("");
  });

  test("can keep a trailing hyphen for a field being typed into", () => {
    expect(slugify("Opening ", { keepTrailingHyphen: true })).toBe("opening-");
    expect(slugify("-Opening-", { keepTrailingHyphen: true })).toBe("opening-");
    expect(slugify("Opening ")).toBe("opening");
  });
});

describe("eventSlugBase", () => {
  // 2026-12-05 18:00 UTC is 01:00 on the 6th in Bangkok.
  const late = Date.UTC(2026, 11, 5, 18);

  test("uses the name when it leaves enough", () => {
    expect(eventSlugBase({ name: "Opening Day", type: "general", startAt: late })).toBe(
      "opening-day",
    );
    expect(eventSlugBase({ name: "ฟุตบอล IT3K", type: "sport", startAt: late })).toBe("it3k");
  });

  test("falls back to type and Bangkok date", () => {
    expect(eventSlugBase({ name: "พิธีเปิด", type: "general", startAt: late })).toBe(
      "general-2026-12-06",
    );
    expect(eventSlugBase({ name: "ฟุตบอล 5 คน", type: "sport", startAt: late })).toBe(
      "sport-2026-12-06",
    );
  });

  test("leaves room for a suffix and ends on a word", () => {
    const base = eventSlugBase({
      name: `${"a".repeat(59)} b c`,
      type: "general",
      startAt: late,
    });
    expect(base).toBe("a".repeat(59));
    expect(`${base}-999`.length).toBeLessThanOrEqual(EVENT_SLUG_MAX);
    expect(eventSlug.safeParse(`${base}-999`).success).toBe(true);
  });
});

describe("firstFreeSlug", () => {
  test("adds the first free number", () => {
    expect(firstFreeSlug("final", new Set())).toBe("final");
    expect(firstFreeSlug("final", new Set(["final"]))).toBe("final-2");
    expect(firstFreeSlug("final", new Set(["final", "final-2", "final-4"]))).toBe("final-3");
  });
});

describe("eventSlug", () => {
  test("allows empty and well-formed slugs", () => {
    for (const slug of ["", "abc", "it3k-final-2", "2569"]) {
      expect(eventSlug.safeParse(slug).success, slug).toBe(true);
    }
    expect(eventSlug.parse("  final  ")).toBe("final");
  });

  test("refuses other shapes", () => {
    for (const slug of [
      "Final",
      "ab",
      "a b",
      "-a",
      "a-",
      "a--b",
      "ไทย",
      "a".repeat(EVENT_SLUG_MAX + 1),
      "2f1c7e0a-6b1d-4c8e-9f3a-0123456789ab",
    ]) {
      expect(eventSlug.safeParse(slug).success, slug).toBe(false);
    }
  });
});
