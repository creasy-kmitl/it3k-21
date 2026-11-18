import type { RichBlock, RichInline, RichTextDoc } from "@it3k/db/rich-text";
import { cn } from "@it3k/ui/lib/utils";
import type { ReactNode } from "react";

function Inline({ node }: { node: RichInline }) {
  if (node.type === "hardBreak") return <br />;
  let out: ReactNode = node.text;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>;
        break;
      case "italic":
        out = <em>{out}</em>;
        break;
      case "underline":
        out = <u>{out}</u>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "link":
        // The schema only lets https:, http: and mailto: through.
        out = (
          <a href={mark.attrs.href} target="_blank" rel="noreferrer noopener">
            {out}
          </a>
        );
        break;
    }
  }
  return <>{out}</>;
}

const inlines = (nodes: RichInline[] | undefined) =>
  (nodes ?? []).map((node, index) => <Inline key={index} node={node} />);

function Block({ block }: { block: RichBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p>{inlines(block.content)}</p>;
    case "heading":
      return block.attrs.level === 2 ? (
        <h2>{inlines(block.content)}</h2>
      ) : (
        <h3>{inlines(block.content)}</h3>
      );
    case "image":
      return <img src={block.attrs.src} alt={block.attrs.alt ?? ""} loading="lazy" />;
    case "horizontalRule":
      return <hr />;
    case "blockquote":
      return <blockquote>{blocks(block.content)}</blockquote>;
    case "bulletList":
      return (
        <ul>
          {block.content.map((item, index) => (
            <li key={index}>{blocks(item.content)}</li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol start={block.attrs?.start}>
          {block.content.map((item, index) => (
            <li key={index}>{blocks(item.content)}</li>
          ))}
        </ol>
      );
  }
}

function blocks(list: RichBlock[]) {
  return list.map((block, index) => <Block key={index} block={block} />);
}

/**
 * A rich-text document drawn as React elements, never as HTML from a string,
 * so only what `richTextDocSchema` allows can show up.
 */
export function RichTextView({
  doc,
  className,
  size = "base",
}: {
  doc: RichTextDoc;
  className?: string;
  size?: "base" | "lg";
}) {
  return (
    <div className={cn("rich-text break-words", size === "lg" && "rich-text-lg", className)}>
      {blocks(doc.content)}
    </div>
  );
}
