import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@it3k/ui/components/field";
import { Spinner } from "@it3k/ui/components/spinner";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleCheck,
  Download,
  FileSpreadsheet,
  ListChecks,
  OctagonX,
  Rows3,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useApis } from "@/lib/api-context";
import { csvBlob } from "@/lib/csv";
import { IMPORT_MAX, type ImportRow, TEMPLATE_ROWS, parseLinkImport } from "@/lib/link-import";
import { type ShortLink, bulkRowErrors } from "@/lib/links";
import { type QrBrowser, qrBrowser } from "@/lib/qr-export";

import { displayUrl } from "./link-parts";
import { QrZipPanel } from "./qr-zip-panel";

/** The created links as a spreadsheet, short URLs included. */
export function linksCsv(links: ShortLink[]) {
  return csvBlob([
    ["title", "slug", "short_url", "qr_url", "destination", "fallback_url", "state", "tags"],
    ...links.map((link) => [
      link.title,
      link.slug,
      link.shortUrl,
      link.qrUrl,
      link.destination,
      link.fallbackUrl ?? "",
      link.state,
      link.tags.join("|"),
    ]),
  ]);
}

function Preview({ rows, serverErrors }: { rows: ImportRow[]; serverErrors: Map<number, string> }) {
  return (
    <div className="max-h-[50vh] overflow-auto rounded-xl border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-background text-muted-foreground">
          <tr className="border-b">
            <th className="px-2 py-1.5 font-medium">แถว</th>
            <th className="px-2 py-1.5 font-medium">ชื่อ</th>
            <th className="px-2 py-1.5 font-medium">ท้ายลิงก์</th>
            <th className="px-2 py-1.5 font-medium">ปลายทาง</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const serverError = serverErrors.get(index);
            const errors = serverError ? [...row.errors, serverError] : row.errors;
            return (
              <tr
                key={row.line}
                className={cn(
                  "border-b align-top last:border-0",
                  errors.length > 0 && "bg-destructive/5",
                )}
              >
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{row.line}</td>
                <td className="px-2 py-1.5">
                  <span className="font-medium">{row.input.title || "—"}</span>
                  {row.input.tags?.length ? (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {row.input.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-muted-foreground">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                  {errors.map((error) => (
                    <span key={error} className="mt-1 flex items-start gap-1 text-destructive">
                      <OctagonX aria-hidden className="mt-px size-3 shrink-0" />
                      {error}
                    </span>
                  ))}
                </td>
                <td className="px-2 py-1.5 font-mono">
                  {row.input.slug ?? <span className="text-muted-foreground">สุ่ม</span>}
                </td>
                <td className="max-w-48 truncate px-2 py-1.5" title={row.input.destination}>
                  {displayUrl(row.input.destination)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Many links from a spreadsheet: paste or upload, check every row, create
 * them all at once, then download their QR codes in one zip.
 */
export function BulkCreate({
  browser = qrBrowser,
  onDone,
}: {
  browser?: QrBrowser;
  onDone: () => void;
}) {
  const { links } = useApis();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: (pending: ImportRow[]) => links.bulk(pending.map((row) => row.input)),
    onSuccess: async (result) => {
      toast.success(`สร้าง ${result.items.length} ลิงก์แล้ว`);
      await queryClient.invalidateQueries({ queryKey: ["links"] });
    },
    onError: (error) => {
      if (!bulkRowErrors(error)) toast.error(`สร้างลิงก์ไม่สำเร็จ: ${error.message}`);
    },
  });

  function check(source = text) {
    const result = parseLinkImport(source, window.location.host);
    create.reset();
    if (!result.ok) {
      setParseError(result.message);
      setRows(null);
      return;
    }
    setParseError(null);
    setRows(result.rows);
  }

  if (create.data) {
    const created = create.data.items;
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <CircleCheck aria-hidden className="size-4 text-emerald-600" />
          สร้าง {created.length} ลิงก์แล้ว
        </p>
        <ul className="flex max-h-48 flex-col gap-1 overflow-auto rounded-xl border p-2 text-xs">
          {created.map((link) => (
            <li key={link.id} className="flex justify-between gap-2">
              <span className="truncate">{link.title}</span>
              <code className="shrink-0 font-mono text-primary">{displayUrl(link.shortUrl)}</code>
            </li>
          ))}
        </ul>
        <QrZipPanel
          links={created}
          fileName={`it3k-qr-${created.length}-links`}
          browser={browser}
        />
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => browser.download(linksCsv(created), "it3k-links.csv")}
          >
            <FileSpreadsheet data-icon="inline-start" />
            ดาวน์โหลดรายการ (CSV)
          </Button>
          <Button variant="ghost" onClick={onDone}>
            เสร็จแล้ว
          </Button>
        </div>
      </div>
    );
  }

  if (rows) {
    const serverErrors = bulkRowErrors(create.error) ?? new Map<number, string>();
    const bad = rows.filter((row, index) => row.errors.length > 0 || serverErrors.has(index));
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p
          role={bad.length > 0 ? "alert" : "status"}
          className={cn("flex items-center gap-2", bad.length > 0 && "text-destructive")}
        >
          {bad.length > 0 ? (
            <OctagonX aria-hidden className="size-4 shrink-0" />
          ) : (
            <ListChecks aria-hidden className="size-4 shrink-0 text-emerald-600" />
          )}
          {bad.length > 0
            ? `มีปัญหา ${bad.length} จาก ${rows.length} แถว แก้ในไฟล์แล้วตรวจใหม่ ยังไม่มีลิงก์ไหนถูกสร้าง`
            : `พร้อมสร้าง ${rows.length} ลิงก์`}
        </p>
        <Preview rows={rows} serverErrors={serverErrors} />
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => setRows(null)}>
            <ArrowLeft data-icon="inline-start" />
            แก้รายการ
          </Button>
          <Button disabled={bad.length > 0 || create.isPending} onClick={() => create.mutate(rows)}>
            {create.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Rows3 data-icon="inline-start" />
            )}
            สร้าง {rows.length} ลิงก์
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        หนึ่งแถวต่อหนึ่งลิงก์ ไม่เกิน {IMPORT_MAX} ลิงก์ต่อครั้ง คอลัมน์ title และ destination จำเป็น ส่วน slug, tags
        (คั่นด้วย |) และ fallback_url ไม่บังคับ
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => browser.download(csvBlob(TEMPLATE_ROWS), "it3k-links-template.csv")}
        >
          <Download data-icon="inline-start" />
          ไฟล์ตัวอย่าง
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload data-icon="inline-start" />
          เลือกไฟล์ CSV
        </Button>
        <input
          ref={fileInput}
          type="file"
          hidden
          aria-label="ไฟล์ CSV"
          accept=".csv,text/csv"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const content = await file.text();
            setText(content);
            check(content);
          }}
        />
      </div>
      <Field>
        <FieldLabel htmlFor="bulk-text">หรือวางจาก Google Sheets หรือ Excel</FieldLabel>
        <Textarea
          id="bulk-text"
          rows={8}
          value={text}
          placeholder={"title\tdestination\tslug\nบูธ ROV\thttps://…\tbooth-rov"}
          className="font-mono text-xs"
          onChange={(event) => setText(event.target.value)}
        />
        <FieldDescription>คัดลอกทั้งตารางรวมหัวตาราง แล้ววางที่นี่ได้เลย</FieldDescription>
      </Field>
      {parseError && (
        <p role="alert" className="text-destructive">
          {parseError}
        </p>
      )}
      <Button disabled={!text.trim()} onClick={() => check()}>
        <ListChecks data-icon="inline-start" />
        ตรวจรายการ
      </Button>
    </div>
  );
}
