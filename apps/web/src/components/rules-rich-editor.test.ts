import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/react";

import { rulesExtensions, tidyMarkdown } from "./rules-rich-editor";

const RULES_DIR = join(import.meta.dir, "../../../../packages/db/sport-rules");

const roundTrip = (markdown: string) =>
  tidyMarkdown(
    new Editor({
      extensions: rulesExtensions(),
      content: markdown,
      contentType: "markdown",
    }).getMarkdown(),
  );

describe("rules as formatted text", () => {
  test("every seeded rule book comes back from the editor exactly as written", () => {
    const files = readdirSync(RULES_DIR).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    );
    expect(files.length).toBeGreaterThan(10);
    for (const name of files) {
      const markdown = readFileSync(join(RULES_DIR, name), "utf8").trim();
      expect({ name, markdown: roundTrip(markdown) }).toEqual({ name, markdown });
    }
  });

  test("ampersands stay plain, other spellings settle on one", () => {
    expect(roundTrip("Map Ban & Pick")).toBe("Map Ban & Pick");
    expect(roundTrip("* หนึ่ง\n* สอง")).toBe("- หนึ่ง\n- สอง");
  });
});
