import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";

import { toXlsx } from "./xlsx";

/** The parts of the workbook, as text. */
function parts(bytes: Uint8Array) {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([path, data]) => [path, strFromU8(data)]),
  );
}

describe("toXlsx", () => {
  test("has every part Excel needs", () => {
    expect(Object.keys(parts(toXlsx("links", [["a"]]))).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  test("writes formula-like text as text cells, never as formulas", () => {
    const sheet = parts(
      toXlsx("links", [
        ["title"],
        ['=HYPERLINK("https://evil.example","คลิก")'],
        ["+1"],
        ["@SUM(A1)"],
      ]),
    )["xl/worksheets/sheet1.xml"];
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;https://evil.example&quot;,&quot;คลิก&quot;)</t></is></c>',
    );
    expect(sheet).toContain('<t xml:space="preserve">+1</t>');
  });

  test("keeps numbers as numbers, bolds the header row and skips empty cells", () => {
    const sheet = parts(
      toXlsx("visits", [
        ["day", "qr"],
        ["2026-09-30", 4],
        [null, 0],
      ]),
    )["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sheet).toContain('<c r="B2"><v>4</v></c>');
    expect(sheet).toContain('<row r="3"><c r="B3"><v>0</v></c></row>');
  });

  test("names columns past Z, escapes markup and drops characters XML cannot hold", () => {
    const row = Array.from({ length: 28 }, (_, i) => `c${i}`);
    row[0] = "a<b>&\u0007c";
    const sheet = parts(toXlsx("x", [row]))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('r="AB1"');
    expect(sheet).toContain(">a&lt;b&gt;&amp;c<");
  });

  test("keeps a sheet name Excel accepts", () => {
    const workbook = parts(toXlsx("a/b:c*d?e[f]g\\h and a very long name past 31", [["x"]]))[
      "xl/workbook.xml"
    ];
    expect(workbook).toContain('name="a b c d e f g h and a very long"');
  });
});
