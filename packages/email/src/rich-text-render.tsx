/** @jsxImportSource react */
import { Heading, Hr, Img, Link, Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import { text } from "./components/layout";
import { publicFileId, type RichBlock, type RichInline, type RichTextDoc } from "./rich-text";
import { theme } from "./theme";

const listStyle: CSSProperties = {
  margin: "0 0 16px",
  paddingLeft: "24px",
  fontSize: "15px",
  lineHeight: "26px",
  color: theme.foreground,
};

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
        out = (
          <Link
            href={mark.attrs.href}
            style={{ color: theme.primary, textDecoration: "underline" }}
          >
            {out}
          </Link>
        );
        break;
    }
  }
  return <>{out}</>;
}

function Inlines({ nodes }: { nodes: RichInline[] | undefined }) {
  if (!nodes?.length) return <>{" "}</>;
  return (
    <>
      {nodes.map((node, index) => (
        <Inline key={index} node={node} />
      ))}
    </>
  );
}

function Blocks({
  blocks,
  apiOrigin,
  tight,
}: {
  blocks: RichBlock[];
  apiOrigin: string;
  tight?: boolean;
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} block={block} apiOrigin={apiOrigin} tight={tight} />
      ))}
    </>
  );
}

function Block({
  block,
  apiOrigin,
  tight,
}: {
  block: RichBlock;
  apiOrigin: string;
  tight?: boolean;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <Text style={tight ? { ...text, margin: "0 0 4px" } : text}>
          <Inlines nodes={block.content} />
        </Text>
      );
    case "heading":
      return (
        <Heading
          as={block.attrs.level === 2 ? "h2" : "h3"}
          style={{
            margin: "8px 0 12px",
            fontSize: block.attrs.level === 2 ? "19px" : "16px",
            lineHeight: block.attrs.level === 2 ? "28px" : "24px",
            fontWeight: 700,
            color: theme.foreground,
          }}
        >
          <Inlines nodes={block.content} />
        </Heading>
      );
    case "image":
      // Only images this deployment serves itself: anything else could be a
      // tracking pixel or vanish later. The API refuses them on the way in too.
      if (!publicFileId(block.attrs.src, apiOrigin)) return null;
      return (
        <Img
          src={block.attrs.src}
          alt={block.attrs.alt ?? ""}
          style={{
            display: "block",
            maxWidth: "100%",
            height: "auto",
            margin: "0 0 16px",
            borderRadius: "8px",
          }}
        />
      );
    case "horizontalRule":
      return <Hr style={{ borderColor: theme.border, margin: "20px 0" }} />;
    case "blockquote":
      return (
        <div
          style={{
            borderLeft: `3px solid ${theme.primary}`,
            padding: "2px 0 2px 14px",
            margin: "0 0 16px",
            color: theme.mutedForeground,
          }}
        >
          <Blocks blocks={block.content} apiOrigin={apiOrigin} tight />
        </div>
      );
    case "bulletList":
    case "orderedList": {
      const items = block.content.map((item, index) => (
        <li key={index} style={{ margin: "0 0 4px" }}>
          <Blocks blocks={item.content} apiOrigin={apiOrigin} tight />
        </li>
      ));
      return block.type === "bulletList" ? (
        <ul style={listStyle}>{items}</ul>
      ) : (
        <ol style={listStyle} start={block.attrs?.start}>
          {items}
        </ol>
      );
    }
  }
}

export function RichText({ doc, apiOrigin }: { doc: RichTextDoc; apiOrigin: string }) {
  return <Blocks blocks={doc.content} apiOrigin={apiOrigin} />;
}
