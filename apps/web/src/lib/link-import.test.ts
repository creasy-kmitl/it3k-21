import { describe, expect, test } from "bun:test";

import { toCsv } from "./csv";
import { IMPORT_MAX, TEMPLATE_ROWS, parseLinkImport } from "./link-import";

const HOST = "it3k.test";

describe("parseLinkImport", () => {
  test("reads the template into clean rows", () => {
    const result = parseLinkImport(toCsv(TEMPLATE_ROWS), HOST);
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          line: 2,
          input: {
            title: "บูธ ROV",
            destination: "https://forms.example.com/rov",
            slug: "booth-rov",
            tags: ["booth", "rov"],
          },
          errors: [],
        },
        {
          line: 3,
          input: {
            title: "บูธ Valorant",
            destination: "https://forms.example.com/valorant",
            tags: ["booth"],
            fallbackUrl: "https://it3k.creasy.club",
          },
          errors: [],
        },
      ],
    });
  });

  test("takes cells pasted from a spreadsheet, which are tab-separated", () => {
    const result = parseLinkImport("title\tdestination\nบูธ, ROV\thttps://a.example", HOST);
    expect(result.ok && result.rows[0]?.input).toEqual({
      title: "บูธ, ROV",
      destination: "https://a.example",
    });
  });

  test("takes Thai headers in any order", () => {
    const result = parseLinkImport("ปลายทาง,ชื่อ\nhttps://a.example,เอ", HOST);
    expect(result.ok && result.rows[0]?.input).toEqual({
      title: "เอ",
      destination: "https://a.example",
    });
  });

  test("marks each bad row with every problem it has", () => {
    const result = parseLinkImport(
      [
        "title,destination,slug,tags",
        ",http://a.example,ok-slug,",
        "B,https://b.example,ok-slug,",
        "C,https://it3k.test/l/x,-bad,a|b|c|d|e|f",
      ].join("\n"),
      HOST,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.rows.map((row) => row.errors.length)).toEqual([2, 1, 3]);
    expect(result.rows[1]?.errors[0]).toContain("ซ้ำ");
  });

  test("refuses a file without the needed columns, without rows, or with too many", () => {
    expect(parseLinkImport("", HOST)).toMatchObject({ ok: false });
    expect(parseLinkImport("slug\nx", HOST)).toMatchObject({ ok: false });
    expect(parseLinkImport("title,destination", HOST)).toMatchObject({ ok: false });
    const many = [
      "title,destination",
      ...Array.from({ length: IMPORT_MAX + 1 }, (_, i) => `t${i},https://a.example`),
    ];
    expect(parseLinkImport(many.join("\n"), HOST)).toMatchObject({ ok: false });
  });

  test("reads back a file this app exported, without the apostrophe it added", () => {
    const result = parseLinkImport(
      toCsv([
        ["title", "destination"],
        ["=บูธ", "https://a.example"],
      ]),
      HOST,
    );
    expect(result.ok && result.rows[0]?.input.title).toBe("=บูธ");
  });

  test("checks every length the API checks, the fallback's included", () => {
    const long = `https://a.example/${"x".repeat(2048)}`;
    const result = parseLinkImport(
      `title,destination,fallback_url\n${"ก".repeat(121)},${long},${long}`,
      HOST,
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.rows[0]?.errors).toEqual([
      "ชื่อยาวเกิน 120 ตัวอักษร",
      "ปลายทางยาวเกินไป",
      "ปลายทางสำรองยาวเกินไป",
    ]);
  });
});
