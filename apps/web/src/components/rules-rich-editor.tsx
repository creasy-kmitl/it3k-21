import { cn } from "@it3k/ui/lib/utils";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import { type AnyExtension, type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { LinkButton, ToolButton } from "@/components/rich-text-editor";

/**
 * What rules may hold: headings 1–3, emphasis, lists, quotes, rules and links.
 * Rules are stored as Markdown, so this is everything `MarkdownView` shows
 * that people write in them; code and images are left out.
 */
export function rulesExtensions(placeholder?: string): AnyExtension[] {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      underline: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto"],
        isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
      },
    }),
    Markdown,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

/**
 * The editor's Markdown, tidied: it escapes `&` as `&amp;`, which reads the
 * same but would show up as a change to every rule with "Ban & Pick" in it.
 */
export function tidyMarkdown(markdown: string) {
  return markdown.replace(/&amp;/g, "&").trim();
}

function toolbarState(editor: Editor) {
  return {
    paragraph: editor.isActive("paragraph"),
    h1: editor.isActive("heading", { level: 1 }),
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    quote: editor.isActive("blockquote"),
    link: editor.isActive("link"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

/**
 * Rules as formatted text that reads and writes Markdown. `onNormalize`
 * gets the Markdown the editor would write for the starting text, so a
 * different but equivalent spelling (`*` lists, `__bold__`) is not taken
 * for an unsaved change.
 */
export function RulesRichEditor({
  id,
  label,
  value,
  onChange,
  onNormalize,
  onDropFile,
  placeholder,
  invalid,
}: {
  id?: string;
  /** The editing area's accessible name. */
  label: string;
  value: string;
  onChange: (markdown: string) => void;
  onNormalize?: (markdown: string) => void;
  /** A file dropped on the editor, such as a .md to load instead of the text. */
  onDropFile?: (file: File) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const callbacks = useRef({ onChange, onNormalize, onDropFile });
  callbacks.current = { onChange, onNormalize, onDropFile };
  // The Markdown the editor last wrote, so our own updates do not reload it.
  const written = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: rulesExtensions(placeholder),
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "markdown rich-text rich-text-lg min-h-[50vh] px-4 py-4 outline-none sm:px-6",
        "aria-label": label,
        ...(id ? { id } : {}),
        role: "textbox",
        "aria-multiline": "true",
      },
      handleDrop: (_view, event) => {
        const file = event.dataTransfer?.files[0];
        if (!file || !callbacks.current.onDropFile) return false;
        event.preventDefault();
        callbacks.current.onDropFile(file);
        return true;
      },
    },
    onCreate: ({ editor: current }) => {
      const markdown = tidyMarkdown(current.getMarkdown());
      written.current = markdown;
      callbacks.current.onNormalize?.(markdown);
    },
    onUpdate: ({ editor: current }) => {
      const markdown = tidyMarkdown(current.getMarkdown());
      written.current = markdown;
      callbacks.current.onChange(markdown);
    },
  });

  // Text replaced from outside (an uploaded file) loads into the editor.
  useEffect(() => {
    if (!editor || value === written.current) return;
    written.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  const watched = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? toolbarState(current) : null),
  });
  // useEditorState only sees the new editor after its first transaction,
  // which an untouched editor never has, so read it directly until then.
  const state = watched ?? (editor ? toolbarState(editor) : null);

  return (
    <div
      className={cn(
        "overflow-clip rounded-2xl border bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        invalid && "border-destructive",
      )}
    >
      <div
        role="toolbar"
        aria-label="จัดรูปแบบ"
        className="sticky top-0 z-10 flex flex-nowrap items-center gap-0.5 overflow-x-auto border-b bg-muted px-1.5 py-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible"
      >
        {editor && state && (
          <>
            <ToolButton
              icon={Undo2}
              label="เลิกทำ"
              disabled={!state.canUndo}
              onClick={() => editor.chain().focus().undo().run()}
            />
            <ToolButton
              icon={Redo2}
              label="ทำซ้ำ"
              disabled={!state.canRedo}
              onClick={() => editor.chain().focus().redo().run()}
            />
            <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
            <ToolButton
              icon={Pilcrow}
              label="ข้อความปกติ"
              active={state.paragraph}
              onClick={() => editor.chain().focus().setParagraph().run()}
            />
            <ToolButton
              icon={Heading1}
              label="ชื่อกีฬา"
              active={state.h1}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            />
            <ToolButton
              icon={Heading2}
              label="หัวข้อ"
              active={state.h2}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolButton
              icon={Heading3}
              label="หัวข้อย่อย"
              active={state.h3}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            />
            <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
            <ToolButton
              icon={Bold}
              label="ตัวหนา"
              active={state.bold}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <ToolButton
              icon={Italic}
              label="ตัวเอียง"
              active={state.italic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <ToolButton
              icon={Strikethrough}
              label="ขีดฆ่า"
              active={state.strike}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <LinkButton editor={editor} active={state.link} />
            <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
            <ToolButton
              icon={List}
              label="รายการ"
              active={state.bullet}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            />
            <ToolButton
              icon={ListOrdered}
              label="รายการลำดับเลข"
              active={state.ordered}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            />
            <ToolButton
              icon={Quote}
              label="ข้อความอ้างอิง"
              active={state.quote}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            />
            <ToolButton
              icon={Minus}
              label="เส้นคั่น"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
            />
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
