import { describe, expect, test } from "bun:test";

import { parseCsv, toCsv } from "./csv";

describe("CSV", () => {
  test("parses quotes, doubled quotes, commas and line breaks inside cells", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n"two\nlines",x,\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["two\nlines", "x", ""],
    ]);
  });

  test("drops a byte-order mark and blank lines, keeps a last line without a newline", () => {
    expect(parseCsv("﻿title,slug\n\n , \nบูธ 1,booth-1")).toEqual([
      ["title", "slug"],
      ["บูธ 1", "booth-1"],
    ]);
  });

  test("writes what it reads back, with a BOM for Excel", () => {
    const rows = [
      ["title", "note"],
      ["บูธ, หนึ่ง", 'say "hi"'],
    ];
    const csv = toCsv(rows);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(parseCsv(csv)).toEqual(rows);
  });
});
