import { PHOTO_TYPES } from "@it3k/db/profile";
import type { RichTextDoc } from "@it3k/email/rich-text";
import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@it3k/ui/components/popover";
import { Progress } from "@it3k/ui/components/progress";
import { cn } from "@it3k/ui/lib/utils";
import FileHandler from "@tiptap/extension-file-handler";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { FileLibrary } from "@/components/file-library";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { publicFileUrl } from "@/lib/files";

export const EMPTY_DOC: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };

const isPhoto = (type: string) => PHOTO_TYPES.some((allowed) => allowed === type);

/** Adds `https://` to a bare address; keeps mailto: and http(s): links as typed. */
export function normalizeHref(raw: string) {
  const href = raw.trim();
  if (!href) return "";
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(href)) return `mailto:${href}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return "";
  return `https://${href}`;
}

function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon aria-hidden />
    </Button>
  );
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeHref(href);
    if (!normalized) {
      setError("ใช้ได้เฉพาะลิงก์ https:// หรืออีเมล");
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !active) {
      // Nothing selected: insert the address itself as the link text.
      chain
        .insertContent({
          type: "text",
          text: href.trim(),
          marks: [{ type: "link", attrs: { href: normalized } }],
        })
        .run();
    } else {
      chain.setLink({ href: normalized }).run();
    }
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setHref((editor.getAttributes("link").href as string | undefined) ?? "");
          setError("");
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="ลิงก์"
            title="ลิงก์"
            aria-pressed={active}
          />
        }
      >
        <Link2 aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Input
            autoFocus
            value={href}
            onChange={(event) => setHref(event.target.value)}
            placeholder="https://… หรือ name@example.com"
            aria-label="ที่อยู่ลิงก์"
            aria-invalid={!!error || undefined}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                <Unlink data-icon="inline-start" aria-hidden />
                เอาลิงก์ออก
              </Button>
            )}
            <Button type="submit" size="sm">
              ใส่ลิงก์
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The rich-text body of a staff email. It produces Tiptap JSON limited to what
 * `@it3k/email/rich-text` accepts: code, alignment and h1 are turned off here.
 * Images are uploaded to the sender's own files and inserted by their public
 * URL, by pasting, dropping, or picking from the file library.
 */
export function RichTextEditor({
  userId,
  value,
  onChange,
  disabled,
  placeholder = "เขียนเนื้อหาอีเมล…",
}: {
  userId: string;
  value: RichTextDoc;
  onChange: (doc: RichTextDoc) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { files } = useApis();
  const [library, setLibrary] = useState(false);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => () => abort.current?.abort(), []);

  async function uploadImages(editor: Editor, list: File[], pos?: number) {
    const photos = list.filter((file) => isPhoto(file.type));
    if (photos.length < list.length) toastError(new Error("รองรับเฉพาะรูป JPG, PNG และ WebP"));
    let at = pos;
    for (const file of photos) {
      const controller = new AbortController();
      abort.current = controller;
      setUpload({ name: file.name, progress: 0 });
      try {
        const { id } = await files.upload(file, {
          userId,
          signal: controller.signal,
          onProgress: (progress) => setUpload({ name: file.name, progress }),
        });
        const node = { type: "image", attrs: { src: publicFileUrl(id), alt: file.name } };
        if (at === undefined) editor.chain().focus().insertContent(node).run();
        else {
          editor.chain().focus().insertContentAt(at, node).run();
          at = undefined;
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          toastError(error, "อัปโหลดรูปไม่สำเร็จ");
        }
        break;
      } finally {
        setUpload(null);
        abort.current = null;
      }
    }
  }

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: value,
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
          isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
        },
      }),
      Image.configure({ allowBase64: false }),
      FileHandler.configure({
        allowedMimeTypes: [...PHOTO_TYPES],
        onPaste: (current, pasted) => void uploadImages(current, pasted),
        onDrop: (current, dropped, pos) => void uploadImages(current, dropped, pos),
      }),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap-email min-h-64 px-4 py-3 outline-none",
        "aria-label": "เนื้อหาอีเมล",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getJSON() as RichTextDoc),
  });

  // A reset from outside (after sending) replaces the document.
  useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            strike: current.isActive("strike"),
            h2: current.isActive("heading", { level: 2 }),
            h3: current.isActive("heading", { level: 3 }),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
            link: current.isActive("link"),
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
          }
        : null,
  });

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        disabled && "opacity-60",
      )}
    >
      <div
        role="toolbar"
        aria-label="จัดรูปแบบ"
        className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1"
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
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
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
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
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
              icon={Underline}
              label="ขีดเส้นใต้"
              active={state.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            />
            <ToolButton
              icon={Strikethrough}
              label="ขีดฆ่า"
              active={state.strike}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <LinkButton editor={editor} active={state.link} />
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
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
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <ToolButton
              icon={ImagePlus}
              label="แทรกรูป"
              disabled={!!upload}
              onClick={() => setLibrary(true)}
            />
          </>
        )}
      </div>
      {upload && (
        <div
          className="flex items-center gap-3 border-b px-4 py-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <span className="truncate">กำลังอัปโหลด {upload.name}</span>
          <Progress value={upload.progress} className="max-w-40 flex-1" />
          <Button type="button" variant="ghost" size="xs" onClick={() => abort.current?.abort()}>
            ยกเลิก
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
      <p className="border-t bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
        วางหรือลากรูปมาใส่ได้เลย รูปจะเก็บไว้ในไฟล์ของคุณ ถ้าลบไฟล์ทีหลัง รูปในอีเมลที่ส่งไปแล้วจะหายด้วย
      </p>
      {library && editor && (
        <FileLibrary
          userId={userId}
          onClose={() => setLibrary(false)}
          selectTitle="เลือกรูปสำหรับอีเมล"
          selectHint="รองรับ JPG, PNG และ WebP"
          onSelect={(file) => {
            setLibrary(false);
            if (!isPhoto(file.contentType)) {
              toastError(new Error("เลือกได้เฉพาะรูป JPG, PNG และ WebP"));
              return;
            }
            editor
              .chain()
              .focus()
              .insertContent({
                type: "image",
                attrs: { src: publicFileUrl(file.id), alt: file.name },
              })
              .run();
          }}
        />
      )}
    </div>
  );
}
