import { describe, expect, test } from "bun:test";

import { type RichTextDoc, docFromText, plainText } from "./rich-text";

describe("plainText", () => {
  const doc: RichTextDoc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "กำหนดการ" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "เริ่ม  9 โมง", marks: [{ type: "bold" }] },
          { type: "hardBreak" },
          { type: "text", text: "ที่สนาม" },
        ],
      },
      { type: "image", attrs: { src: "https://x.test/a.png" } },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "ข้อแรก" }] }] }],
      },
      { type: "paragraph" },
    ],
  };

  test("keeps the text, one block per line", () => {
    expect(plainText(doc)).toBe("กำหนดการ\nเริ่ม 9 โมง ที่สนาม\nข้อแรก");
  });

  test("cuts long text with an ellipsis", () => {
    expect(plainText(doc, 12)).toBe("กำหนดการ\nเร…");
    // A cut at a line break drops the break.
    expect(plainText(doc, 10)).toBe("กำหนดการ…");
  });
});

test("docFromText turns lines into paragraphs", () => {
  expect(docFromText("แรก\n\nสอง")).toEqual({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "แรก" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "สอง" }] },
    ],
  });
});
