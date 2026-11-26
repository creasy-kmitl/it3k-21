import { RULES_MAX_LENGTH, type RulesInput } from "@it3k/db/sport-rules";
import { Button } from "@it3k/ui/components/button";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import {
  BookOpen,
  Code2,
  Download,
  Eye,
  FilePlus2,
  Pencil,
  Trash2,
  Type,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDelete } from "@/components/form-dialog";
import { LoadingButton } from "@/components/loading-button";
import { MarkdownView } from "@/components/markdown-view";
import { RulesRichEditor } from "@/components/rules-rich-editor";
import { SegmentedControl } from "@/components/segmented-control";
import { toastError } from "@/lib/errors";
import type { SavedRules } from "@/lib/sport-rules";

/** Bigger files are not rules; reading them would only freeze the page. */
const MAX_FILE_BYTES = 512 * 1024;
const MARKDOWN_FILE = /\.(md|markdown|txt)$/i;

const updatedAtFormat = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

type Pane = "write" | "preview";
/** Formatted text by default; Markdown source for people who prefer it. */
type Mode = "rich" | "markdown";

/** Reads a dropped or chosen Markdown file, or says why it cannot be used. */
export async function readMarkdownFile(file: File): Promise<string> {
  if (!MARKDOWN_FILE.test(file.name) && !file.type.startsWith("text/")) {
    throw new Error("เลือกไฟล์ Markdown (.md)");
  }
  if (file.size > MAX_FILE_BYTES) throw new Error("ไฟล์ใหญ่เกิน 512 KB");
  const text = (await file.text()).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (text.length > RULES_MAX_LENGTH) {
    throw new Error(`กติกายาวได้ไม่เกิน ${RULES_MAX_LENGTH.toLocaleString("en-US")} ตัวอักษร`);
  }
  return text;
}

function download(markdown: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * One sport's or division's rules: read them, and for rule editors write them
 * as Markdown or replace them with an uploaded .md file. `fallback` is what
 * shows while there are none, such as a division showing its sport's rules.
 */
export function RulesEditor({
  saved,
  fallback,
  canEdit,
  fileName,
  emptyText,
  removeLabel,
  onSave,
  onDirtyChange,
}: {
  saved: SavedRules | null;
  fallback?: { label: string; markdown: string } | null;
  canEdit: boolean;
  fileName: string;
  emptyText: string;
  removeLabel: string;
  onSave: (input: RulesInput) => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // The text being edited, and what it started from; null while only reading.
  const [draft, setDraft] = useState<{ text: string; base: string } | null>(null);
  const [pane, setPane] = useState<Pane>("write");
  const [mode, setMode] = useState<Mode>("rich");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaId = useId();
  const dirty = draft !== null && draft.text !== draft.base;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: (markdown: string) => onSave({ markdown, version: saved?.version ?? 0 }),
    onSuccess: (_result, markdown) => {
      toast.success(markdown.trim() ? "บันทึกกติกาแล้ว" : "ลบกติกาแล้ว");
      setDraft(null);
      setConfirmRemove(false);
    },
    // The draft stays, so a refused save loses nothing; it can be downloaded first.
    onError: (error) => toastError(error, "บันทึกกติกาไม่สำเร็จ"),
  });

  const startEditing = (text: string) => {
    setDraft({ text, base: saved?.markdown ?? "" });
    setPane("write");
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await readMarkdownFile(file);
      setDraft((current) => ({ text, base: current?.base ?? saved?.markdown ?? "" }));
      setPane("preview");
      toast.success(`โหลด ${file.name} แล้ว`, { description: "ตรวจดูเนื้อหา แล้วกดบันทึก" });
    } catch (error) {
      toastError(error, "ใช้ไฟล์นี้ไม่ได้");
    }
  };

  const fileButton = canEdit && (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-label="อัปโหลดไฟล์กติกา (.md)"
        onChange={(event) => {
          void loadFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
        <Upload /> อัปโหลด .md
      </Button>
    </>
  );

  if (draft === null) {
    const shown = saved?.markdown ?? fallback?.markdown ?? null;
    return (
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && saved && (
            <Button size="sm" onClick={() => startEditing(saved.markdown)}>
              <Pencil /> แก้ไข
            </Button>
          )}
          {canEdit && !saved && (
            <>
              <Button size="sm" onClick={() => startEditing("")}>
                <FilePlus2 /> {fallback ? "เขียนกติกาเฉพาะประเภทนี้" : "เขียนกติกา"}
              </Button>
              {fallback && (
                <Button variant="outline" size="sm" onClick={() => startEditing(fallback.markdown)}>
                  <BookOpen /> เริ่มจาก{fallback.label}
                </Button>
              )}
            </>
          )}
          {fileButton}
          {shown && (
            <Button variant="ghost" size="sm" onClick={() => download(shown, fileName)}>
              <Download /> ดาวน์โหลด .md
            </Button>
          )}
          {canEdit && saved && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive sm:ml-auto"
              onClick={() => setConfirmRemove(true)}
            >
              {fallback ? <Undo2 /> : <Trash2 />} {removeLabel}
            </Button>
          )}
        </div>

        {saved ? (
          <p className="text-xs text-muted-foreground">
            แก้ไขล่าสุด {updatedAtFormat.format(new Date(saved.updatedAt))}
            {saved.updatedByName && ` โดย ${saved.updatedByName}`}
          </p>
        ) : (
          fallback && (
            <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              ประเภทนี้ยังไม่มีกติกาของตัวเอง จึงแสดง{fallback.label}
            </p>
          )
        )}

        {shown ? (
          <article className="rounded-2xl border bg-card p-4 sm:p-6">
            <MarkdownView markdown={shown} className="rich-text-lg" />
          </article>
        ) : (
          <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
            {emptyText}
          </p>
        )}

        {confirmRemove && (
          <ConfirmDelete
            name={fallback ? "กติกาเฉพาะประเภทนี้" : "กติกานี้"}
            description={
              fallback ? `ประเภทนี้จะกลับไปแสดง${fallback.label}` : "ดาวน์โหลดเก็บไว้ก่อนได้ ถ้าอาจต้องใช้อีก"
            }
            pending={save.isPending}
            onClose={() => setConfirmRemove(false)}
            onConfirm={() => save.mutate("")}
          />
        )}
      </section>
    );
  }

  const length = draft.text.length;
  const tooLong = length > RULES_MAX_LENGTH;
  const counter = (
    <p className={cn("text-right text-xs text-muted-foreground", tooLong && "text-destructive")}>
      {length.toLocaleString("en-US")} / {RULES_MAX_LENGTH.toLocaleString("en-US")} ตัวอักษร ·
      ลากไฟล์ .md มาวางได้
    </p>
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<Mode>
          label="รูปแบบการแก้"
          value={mode}
          onChange={setMode}
          segments={[
            { value: "rich", label: "จัดรูปแบบ", icon: Type },
            { value: "markdown", label: "แก้แบบ Markdown", icon: Code2 },
          ]}
        />
        {mode === "markdown" && (
          <SegmentedControl<Pane>
            label="มุมมอง"
            className="lg:hidden"
            value={pane}
            onChange={setPane}
            segments={[
              { value: "write", label: "เขียน", icon: Pencil },
              { value: "preview", label: "ตัวอย่าง", icon: Eye },
            ]}
          />
        )}
        {fileButton}
        <Button variant="ghost" size="sm" onClick={() => download(draft.text, fileName)}>
          <Download /> ดาวน์โหลด .md
        </Button>
      </div>

      {mode === "rich" ? (
        <div className="flex flex-col gap-1">
          <RulesRichEditor
            id={textareaId}
            label="กติกา"
            value={draft.text}
            invalid={tooLong}
            placeholder={fallback ? `เว้นว่างไว้เพื่อใช้${fallback.label}` : "เริ่มเขียนกติกา…"}
            onChange={(text) => setDraft((current) => current && { ...current, text })}
            onNormalize={(text) =>
              setDraft((current) => {
                if (!current) return current;
                // Untouched text takes the editor's spelling on both sides,
                // so opening the editor alone is not an unsaved change.
                if (current.text === current.base) return { text, base: text };
                return { ...current, text };
              })
            }
            onDropFile={(file) => void loadFile(file)}
          />
          {counter}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={cn("flex flex-col gap-1", pane !== "write" && "hidden lg:flex")}>
            <label htmlFor={textareaId} className="sr-only">
              กติกา (Markdown)
            </label>
            <Textarea
              id={textareaId}
              value={draft.text}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              onDragOver={(event) => {
                if (canEdit && event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.files.length) return;
                event.preventDefault();
                void loadFile(event.dataTransfer.files[0]);
              }}
              placeholder={"# ชื่อกีฬา\n\n## ข้อ 1. ...\n\n- **1.1** ..."}
              spellCheck={false}
              aria-invalid={tooLong || undefined}
              className="min-h-[50vh] font-mono text-sm leading-relaxed"
            />
            {counter}
          </div>
          <article
            aria-label="ตัวอย่าง"
            className={cn(
              "min-h-[50vh] rounded-2xl border bg-card p-4 sm:p-6",
              pane !== "preview" && "hidden lg:block",
            )}
          >
            {draft.text.trim() ? (
              <MarkdownView markdown={draft.text} className="rich-text-lg" />
            ) : (
              <p className="text-muted-foreground">
                {fallback ? `เว้นว่างไว้เพื่อใช้${fallback.label}` : "เว้นว่างไว้คือไม่มีกติกา"}
              </p>
            )}
          </article>
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {dirty && <span className="mr-auto text-xs text-muted-foreground">ยังไม่ได้บันทึก</span>}
        <Button variant="outline" onClick={() => setDraft(null)} disabled={save.isPending}>
          ยกเลิก
        </Button>
        <LoadingButton
          loading={save.isPending}
          disabled={tooLong || !dirty}
          onClick={() => save.mutate(draft.text)}
        >
          บันทึก
        </LoadingButton>
      </div>
    </section>
  );
}
