import { afterEach, describe, expect, test } from "bun:test";
import type { RichTextDoc } from "@it3k/db/rich-text";
import { cleanup, render } from "@testing-library/react";

import { RichTextView } from "./rich-text-view";

afterEach(cleanup);

const DOC: RichTextDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "กำหนดการ" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "เปิดประตู", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "hardBreak" },
        {
          type: "text",
          text: "แผนที่",
          marks: [{ type: "link", attrs: { href: "https://maps.example/v-1" } }],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "ลงทะเบียน" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "พิธีเปิด" }] }] },
      ],
    },
    { type: "image", attrs: { src: "https://files.example/a.png", alt: "โปสเตอร์" } },
    { type: "horizontalRule" },
  ],
};

describe("RichTextView", () => {
  test("draws each block and mark as its own element", () => {
    const view = render(<RichTextView doc={DOC} size="lg" />);
    expect(view.getByRole("heading", { level: 2, name: "กำหนดการ" })).toBeTruthy();
    // Marks wrap in order: bold inside, italic around it.
    const marked = view.getByText("เปิดประตู");
    expect(marked.tagName).toBe("STRONG");
    expect(marked.parentElement?.tagName).toBe("EM");
    const link = view.getByRole("link", { name: "แผนที่" });
    expect(link.getAttribute("href")).toBe("https://maps.example/v-1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(view.container.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(view.getAllByRole("listitem")).toHaveLength(2);
    expect(view.getByRole("img", { name: "โปสเตอร์" }).getAttribute("src")).toBe(
      "https://files.example/a.png",
    );
    expect(view.container.querySelector("hr")).toBeTruthy();
    expect(view.container.firstElementChild?.className).toContain("rich-text-lg");
  });

  test("text that looks like HTML stays text", () => {
    const view = render(
      <RichTextView
        doc={{
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] }],
        }}
      />,
    );
    expect(view.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
  });
});
