import { cn } from "@it3k/ui/lib/utils";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [remarkGfm];

/**
 * Markdown drawn as React elements. Raw HTML in it is dropped, and
 * react-markdown's default URL filter keeps out `javascript:` links.
 */
export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn("markdown rich-text break-words", className)}>
      <Markdown
        remarkPlugins={remarkPlugins}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
