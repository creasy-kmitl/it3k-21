import { z } from "zod";

/**
 * The subset of Tiptap's JSON document that a staff email may contain. The
 * editor produces more than this (code blocks, alignment, …); the editor turns
 * those off, and anything else is refused here rather than passed through, so
 * the renderer only ever meets nodes it knows how to draw safely.
 *
 * The document is stored and rendered as JSON. It never becomes raw HTML.
 */

export type RichMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "link"; attrs: { href: string } };

export type RichInline = { type: "text"; text: string; marks?: RichMark[] } | { type: "hardBreak" };

export type RichListItem = { type: "listItem"; content: RichBlock[] };

export type RichBlock =
  | { type: "paragraph"; content?: RichInline[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: RichInline[] }
  | { type: "image"; attrs: { src: string; alt?: string | null } }
  | { type: "horizontalRule" }
  | { type: "blockquote"; content: RichBlock[] }
  | { type: "bulletList"; content: RichListItem[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: RichListItem[] };

export type RichTextDoc = { type: "doc"; content: RichBlock[] };

/** Deeper nesting than this is not something a person writes by hand. */
export const MAX_DEPTH = 8;
/** Serialized size cap, checked before parsing. */
export const MAX_DOC_BYTES = 200_000;

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

const markSchema: z.ZodType<RichMark> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("underline") }),
  z.object({ type: z.literal("strike") }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({
      href: z
        .string()
        .trim()
        .max(2000)
        .refine((href) => SAFE_HREF.test(href), "ลิงก์ต้องขึ้นต้นด้วย https:// หรือ mailto:"),
    }),
  }),
]);

const inlineSchema: z.ZodType<RichInline> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().min(1).max(20_000),
    marks: z.array(markSchema).max(5).optional(),
  }),
  z.object({ type: z.literal("hardBreak") }),
]);

const inlineContent = z.array(inlineSchema).max(2000).optional();

const listItemSchema: z.ZodType<RichListItem> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(blockSchema).min(1).max(50) }),
);

const blockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), content: inlineContent }),
    z.object({
      type: z.literal("heading"),
      attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
      content: inlineContent,
    }),
    z.object({
      type: z.literal("image"),
      attrs: z.object({
        src: z.url({ protocol: /^https?$/ }).max(1000),
        alt: z.string().max(500).nullish(),
      }),
    }),
    z.object({ type: z.literal("horizontalRule") }),
    z.object({ type: z.literal("blockquote"), content: z.array(blockSchema).min(1).max(200) }),
    z.object({ type: z.literal("bulletList"), content: z.array(listItemSchema).min(1).max(200) }),
    z.object({
      type: z.literal("orderedList"),
      attrs: z.object({ start: z.number().int().min(0).max(10_000).optional() }).optional(),
      content: z.array(listItemSchema).min(1).max(200),
    }),
  ]),
);

const docSchema: z.ZodType<RichTextDoc> = z.object({
  type: z.literal("doc"),
  content: z.array(blockSchema).min(1).max(1000),
});

/** How deeply `value` nests, counted without recursion so a hostile payload cannot blow the stack. */
function depth(value: unknown) {
  let max = 0;
  const stack: Array<[unknown, number]> = [[value, 0]];
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    const [node, level] = entry;
    if (level > max) max = level;
    if (max > MAX_DEPTH * 3) return max;
    if (node && typeof node === "object") {
      for (const child of Object.values(node)) {
        if (child && typeof child === "object") stack.push([child, level + 1]);
      }
    }
  }
  return max;
}

/**
 * Validates a Tiptap document. Each level of block nesting costs three levels
 * of JSON (node → content array → child), hence the `* 3`.
 */
export const richTextDocSchema = z
  .unknown()
  .refine((value) => depth(value) <= MAX_DEPTH * 3, "เนื้อหาซ้อนกันลึกเกินไป")
  .pipe(docSchema);

/** Every image `src` in the document, in order. */
export function imageSources(doc: RichTextDoc) {
  const sources: string[] = [];
  const visit = (blocks: RichBlock[]) => {
    for (const block of blocks) {
      if (block.type === "image") sources.push(block.attrs.src);
      else if (block.type === "blockquote") visit(block.content);
      else if (block.type === "bulletList" || block.type === "orderedList") {
        for (const item of block.content) visit(item.content);
      }
    }
  };
  visit(doc.content);
  return sources;
}

/** Whether the document has anything a reader would see. */
export function hasContent(doc: RichTextDoc) {
  const visit = (blocks: RichBlock[]): boolean =>
    blocks.some((block) => {
      switch (block.type) {
        case "paragraph":
        case "heading":
          return (block.content ?? []).some((node) => node.type === "text" && node.text.trim());
        case "image":
          return true;
        case "blockquote":
          return visit(block.content);
        case "bulletList":
        case "orderedList":
          return block.content.some((item) => visit(item.content));
        default:
          return false;
      }
    });
  return visit(doc.content);
}

/** The id inside a `<apiOrigin>/api/files/public/<id>` URL, or null for any other URL. */
export function publicFileId(src: string, apiOrigin: string) {
  let url: URL;
  let origin: string;
  try {
    url = new URL(src);
    origin = new URL(apiOrigin).origin;
  } catch {
    return null;
  }
  if (url.origin !== origin || url.search || url.hash) return null;
  const match = /^\/+api\/files\/public\/([0-9a-f-]{36})$/i.exec(url.pathname);
  return match?.[1] ?? null;
}
