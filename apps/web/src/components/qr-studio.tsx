import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { ButtonGroup } from "@it3k/ui/components/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldSeparator } from "@it3k/ui/components/field";
import { Spinner } from "@it3k/ui/components/spinner";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import {
  AlertTriangle,
  Ban,
  Binary,
  ChevronDown,
  Code,
  CircleCheck,
  Eye,
  Download,
  FileCode,
  FileImage,
  FileType,
  Image as ImageIcon,
  ImagePlus,
  type LucideIcon,
  OctagonX,
  PenLine,
  QrCode,
  RotateCcw,
  Scaling,
  ScanQrCode,
  ShieldCheck,
  TextCursorInput,
  Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { SideDrawer } from "@/components/calendar/side-drawer";
import { PageHeader } from "@/components/page-header";
import { QrPresetBar } from "@/components/qr-preset-bar";
import {
  AdvancedFields,
  ColorFields,
  FormSection,
  LabelRow,
  type Option,
  OptionSelect,
  ShapeFields,
} from "@/components/qr-design-form";
import {
  DEFAULT_DESIGN,
  LOGO_SIZE_MAX,
  type EncodeFailure,
  type ExportSize,
  type QrDesign,
  type QrIssue,
  assessQr,
  encodeQr,
  normalizeDesign,
  qrFileName,
  renderQrSvg,
  shortFileName,
  svgDataUrl,
} from "@/lib/qr";
import { useMediaQuery } from "@/hooks/use-media-query";
import { LOGO_TYPES, type QrBrowser, qrBrowser } from "@/lib/qr-export";
import { type QrPreset, fromPresetDesign, toPresetDesign } from "@/lib/qr-presets";
import {
  DEFAULT_SETTINGS,
  type QrSettings,
  type UploadedLogo,
  loadQrSettings,
  saveQrSettings,
} from "@/lib/qr-settings";

const FAILURES: Record<EncodeFailure, string> = {
  empty: "กรอก URL หรือข้อความเพื่อสร้าง QR",
  "too-long": "ข้อความยาวเกินกว่าที่ QR จะเก็บได้ ลองทำให้สั้นลง",
  unencodable: "มีตัวอักษรที่แปลงเป็น QR ไม่ได้ ลองลบแล้วพิมพ์ใหม่",
};

// No IT3K logo option until PR/Art publish an official mark. "upload" is an
// action, not a state: picking it opens the file picker, and the select moves
// to "custom" only once a file has loaded.
type LogoChoice = "none" | "custom" | "upload";

const logoOptions = (fileName: string | null): Option<LogoChoice>[] => [
  { value: "none", label: "ไม่มีโลโก้", icon: Ban },
  ...(fileName
    ? [
        {
          value: "custom" as const,
          label: shortFileName(fileName),
          title: fileName,
          icon: ImageIcon,
        },
      ]
    : []),
  { value: "upload", label: fileName ? "เลือกรูปใหม่…" : "อัปโหลดรูป…", icon: Upload },
];

const LOGO_SIZE_OPTIONS: Option<string>[] = [
  { value: "0.14", label: "เล็ก" },
  { value: "0.18", label: "กลาง" },
  { value: String(LOGO_SIZE_MAX), label: "ใหญ่" },
].map((option) => ({ ...option, icon: Scaling }));

type Format = "png" | "svg" | "jpg";

// Browsers only put PNG on the clipboard as an image, so there is no JPG
// copy; SVG goes as markup, which design tools paste as vectors.
type CopyFormat = "png" | "svg";

type MenuChoice = { key: string; title: string; description: string; icon: LucideIcon };

const downloadChoices = (px: number): (MenuChoice & { key: Format })[] => [
  { key: "png", title: "PNG", description: `รูปภาพ ${px} px ใช้ได้ทั่วไป`, icon: FileImage },
  {
    key: "svg",
    title: "SVG",
    description: "เวกเตอร์ ขยายได้ไม่จำกัด เหมาะกับงานพิมพ์",
    icon: FileCode,
  },
  { key: "jpg", title: "JPG", description: `ไฟล์เล็ก ${px} px ไม่มีพื้นโปร่งใส`, icon: FileType },
];

const COPY_CHOICES: (MenuChoice & { key: CopyFormat })[] = [
  {
    key: "png",
    title: "รูป PNG",
    description: "วางในแชต สไลด์ หรือเอกสาร",
    icon: ImageIcon,
  },
  {
    key: "svg",
    title: "โค้ด SVG",
    description: "วางใน Figma หรือ Illustrator เป็นเวกเตอร์",
    icon: Code,
  },
];

function MenuGroup<K extends string>({
  heading,
  choices,
  onChoose,
}: {
  heading: string;
  choices: (MenuChoice & { key: K })[];
  onChoose: (key: K) => void;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{heading}</DropdownMenuLabel>
      {choices.map((choice) => (
        <DropdownMenuItem key={choice.key} onClick={() => onChoose(choice.key)}>
          {/* The menu item sets its focus colour on every descendant, down to
              each <path> in the icon, and lucide strokes with currentColor,
              which each path resolves against its own colour. So the red has
              to reach every element in the box, not just the <svg>. */}
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 **:text-primary!">
            <choice.icon aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">{choice.title}</span>
            <span className="text-xs text-muted-foreground!">{choice.description}</span>
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );
}

/**
 * One split button: the main part downloads a PNG, the most common need, in
 * one click; the arrow opens every other file and copy option.
 */
function ExportButton({
  exportSize,
  busy,
  disabled,
  onDownload,
  onCopy,
}: {
  exportSize: number;
  busy: boolean;
  disabled: boolean;
  onDownload: (format: Format) => void;
  onCopy: (format: CopyFormat) => void;
}) {
  return (
    <ButtonGroup aria-label="ส่งออก QR" className="w-full">
      <Button className="flex-1" disabled={disabled} onClick={() => onDownload("png")}>
        {busy ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
        ดาวน์โหลด PNG
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={<Button size="icon" aria-label="ตัวเลือกดาวน์โหลดและคัดลอก" />}
        >
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <MenuGroup
            heading="ดาวน์โหลดเป็นไฟล์"
            choices={downloadChoices(exportSize)}
            onChoose={onDownload}
          />
          <DropdownMenuSeparator />
          <MenuGroup heading="คัดลอกไปวางที่อื่น" choices={COPY_CHOICES} onChoose={onCopy} />
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

const COMPACT = "(max-width: 1023px)";

/**
 * The phone bar: pinned to the bottom of the screen with a live thumbnail
 * that opens the full preview, the export button, and one line on anything
 * that stops the QR scanning.
 */
function ActionBar({
  svg,
  headline,
  onPreview,
  exportButton,
}: {
  svg: string | null;
  headline: QrIssue | null;
  onPreview: () => void;
  exportButton: ReactNode;
}) {
  return (
    <section
      aria-label="แถบคำสั่ง"
      className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-2xl border bg-background/85 p-2 backdrop-blur-xl"
    >
      {headline && (
        <button
          type="button"
          onClick={onPreview}
          className={cn(
            "flex items-start gap-2 rounded-xl px-2 py-1 text-left text-xs",
            headline.level === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400",
          )}
        >
          {headline.level === "error" ? (
            <OctagonX aria-hidden className="mt-px size-3.5 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
          )}
          <span className="line-clamp-2">{headline.message}</span>
        </button>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" className="relative shrink-0 pl-1.5" onClick={onPreview}>
          {svg ? (
            <img src={svgDataUrl(svg)} alt="" className="size-6 rounded-md" />
          ) : (
            <Eye data-icon="inline-start" />
          )}
          ดูตัวอย่าง
          {headline && (
            <span
              aria-hidden
              className={cn(
                "absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
                headline.level === "error" ? "bg-destructive" : "bg-amber-500",
              )}
            />
          )}
        </Button>
        <div className="min-w-0 flex-1">{exportButton}</div>
      </div>
    </section>
  );
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** A bordered panel like the other staff pages' boxes: a titled header over a body. */
function Panel({
  icon: Icon,
  title,
  description,
  label,
  action,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  label: string;
  /** A small button at the header's right. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn("flex flex-col rounded-2xl border text-sm", className)}
    >
      <header className="flex flex-col gap-1 p-4 pb-0">
        <div className="flex items-center gap-2">
          <h2 className="flex flex-1 items-center gap-2 font-heading text-base font-medium">
            <Icon aria-hidden className="size-5 text-primary" />
            {title}
          </h2>
          {action}
        </div>
        {description && <p className="text-muted-foreground">{description}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** QR Studio: design a static QR code and export it, all inside the browser. */
export function QrStudio({
  browser = qrBrowser,
  initialText = "",
}: {
  browser?: QrBrowser;
  /** What to encode at first, e.g. a short link opened from its page. */
  initialText?: string;
}) {
  // Read once: settings saved on an earlier visit in this browser.
  const [saved] = useState(loadQrSettings);
  const [text, setText] = useState(initialText);
  const [design, setDesign] = useState<QrDesign>(() => ({
    ...saved.design,
    logo:
      saved.logoOn && saved.uploaded
        ? { dataUrl: saved.uploaded.dataUrl, size: saved.logoSize }
        : null,
  }));
  const [exportSize, setExportSize] = useState<ExportSize>(saved.exportSize);
  const [logoChoice, setLogoChoice] = useState<Exclude<LogoChoice, "upload">>(
    saved.logoOn ? "custom" : "none",
  );
  const [uploaded, setUploaded] = useState<UploadedLogo | null>(saved.uploaded);
  const fileInput = useRef<HTMLInputElement>(null);
  const [logoSize, setLogoSize] = useState(saved.logoSize);
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  // Below the two-column width the preview moves into a drawer, opened from a
  // bar that stays at the bottom of the screen.
  const compact = useMediaQuery(COMPACT);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exporting, setExporting] = useState<Format | `copy-${CopyFormat}` | null>(null);
  // Only the latest logo request may land, so a slow load cannot undo a newer choice.
  const logoRequest = useRef(0);

  const change = (patch: Partial<QrDesign>) => setDesign((current) => ({ ...current, ...patch }));

  const { logo, ...designFields } = design;
  const settings: QrSettings = {
    design: designFields,
    exportSize,
    logoSize,
    uploaded,
    logoOn: logo !== null,
  };
  const settingsJson = JSON.stringify(settings);
  const isDefault = settingsJson === JSON.stringify(DEFAULT_SETTINGS);
  // Keyed on the JSON, so only a real change writes to storage.
  useEffect(() => saveQrSettings(settings), [settingsJson]);

  function resetSettings() {
    logoRequest.current++;
    setLogoLoading(false);
    setLogoError(null);
    setDesign(DEFAULT_DESIGN);
    setExportSize(DEFAULT_SETTINGS.exportSize);
    setLogoSize(DEFAULT_SETTINGS.logoSize);
    setUploaded(null);
    setLogoChoice("none");
    toast.success("กลับเป็นค่าเริ่มต้นแล้ว");
  }

  // Preview and every export come from this one SVG, rebuilt from the current
  // input on each render, so a download always matches what is on screen.
  const result = useMemo(() => {
    const encoded = encodeQr(text, normalizeDesign(design).ecc);
    if (!encoded.ok) return { svg: null, failure: encoded.reason, issues: [], qr: null };
    return {
      svg: renderQrSvg(encoded.qr, design, exportSize),
      failure: null,
      issues: assessQr(design, encoded.qr, exportSize),
      qr: encoded.qr,
    };
  }, [text, design, exportSize]);
  const { svg, failure, issues, qr } = result;
  const blocked = !svg || issues.some((issue) => issue.level === "error");

  async function uploadLogo(file: File) {
    const request = ++logoRequest.current;
    setLogoError(null);
    setLogoLoading(true);
    try {
      const dataUrl = await browser.loadLogo(file);
      if (request !== logoRequest.current) return;
      setUploaded({ name: file.name, dataUrl });
      setLogoChoice("custom");
      change({ logo: { dataUrl, size: logoSize } });
    } catch (error) {
      // A refused file leaves whatever logo was there before.
      if (request !== logoRequest.current) return;
      setLogoError(error instanceof Error ? error.message : "โหลดโลโก้ไม่สำเร็จ");
    } finally {
      if (request === logoRequest.current) setLogoLoading(false);
    }
  }

  function chooseLogo(choice: LogoChoice) {
    if (choice === "upload") {
      // Still inside the click or keypress, so the browser lets the picker open.
      fileInput.current?.click();
      return;
    }
    // Any pick drops a load still in flight.
    logoRequest.current++;
    setLogoLoading(false);
    setLogoError(null);
    setLogoChoice(choice);
    change({
      logo: choice === "custom" && uploaded ? { dataUrl: uploaded.dataUrl, size: logoSize } : null,
    });
  }

  /** Takes on a preset's design whole, its logo included. */
  function applyPreset(preset: QrPreset) {
    const { design: next, exportSize: size } = fromPresetDesign(preset.design);
    logoRequest.current++;
    setLogoLoading(false);
    setLogoError(null);
    setDesign(next);
    setExportSize(size);
    if (next.logo) {
      setUploaded({ name: `โลโก้จาก ${preset.name}`, dataUrl: next.logo.dataUrl });
      setLogoSize(next.logo.size);
      setLogoChoice("custom");
    } else {
      setLogoChoice("none");
    }
  }

  function resizeLogo(size: number) {
    setLogoSize(size);
    if (design.logo) change({ logo: { ...design.logo, size } });
  }

  async function exportAs(format: Format) {
    if (!svg || blocked) return;
    const name = qrFileName(text, format);
    setExporting(format);
    try {
      const blob =
        format === "svg"
          ? new Blob([svg], { type: "image/svg+xml" })
          : await browser.rasterize(svg, format === "png" ? "image/png" : "image/jpeg", exportSize);
      browser.download(blob, name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้างไฟล์ไม่สำเร็จ");
    } finally {
      setExporting(null);
    }
  }

  async function copy(format: CopyFormat) {
    if (!svg || blocked) return;
    const png = () => browser.rasterize(svg, "image/png", exportSize);
    setExporting(`copy-${format}`);
    try {
      const copied = await (format === "png" ? browser.copyPng(png) : browser.copyText(svg)).catch(
        () => false,
      );
      if (copied) {
        toast.success(
          format === "png"
            ? "คัดลอกรูป QR แล้ว"
            : "คัดลอกโค้ด SVG แล้ว วางใน Figma หรือ Illustrator ได้เลย",
        );
        return;
      }
      // Whatever could not be copied is still wanted: hand over the same file instead.
      browser.download(
        format === "png" ? await png() : new Blob([svg], { type: "image/svg+xml" }),
        qrFileName(text, format),
      );
      toast.info(`เบราว์เซอร์นี้คัดลอก ${format.toUpperCase()} ไม่ได้ จึงดาวน์โหลดไฟล์ให้แทน`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้างไฟล์ไม่สำเร็จ");
    } finally {
      setExporting(null);
    }
  }

  const preview = (
    <>
      {svg ? (
        <img
          src={svgDataUrl(svg)}
          alt={`QR code ของ ${text}`}
          className="aspect-square w-full max-w-72 rounded-2xl border"
        />
      ) : (
        <div className="flex aspect-square w-full max-w-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
          <QrCode aria-hidden className="size-16 opacity-30" />
        </div>
      )}

      {qr && (
        <div className="flex flex-wrap justify-center gap-1.5">
          <Badge variant="secondary">
            <Binary aria-hidden data-icon="inline-start" />
            {utf8Length(text)} ไบต์
          </Badge>
          <Badge variant="secondary">
            <QrCode aria-hidden data-icon="inline-start" />
            เวอร์ชัน {qr.version} · {qr.size}×{qr.size}
          </Badge>
          <Badge variant="secondary">
            <ShieldCheck aria-hidden data-icon="inline-start" />
            ระดับ {normalizeDesign(design).ecc}
          </Badge>
        </div>
      )}

      <div aria-live="polite" className="flex w-full flex-col gap-2">
        {failure && (
          <p
            className={cn(
              "flex items-start gap-2",
              failure === "empty" ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {failure === "empty" ? (
              <PenLine aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <OctagonX aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            {FAILURES[failure]}
          </p>
        )}
        {issues.map((issue) => (
          <p
            key={issue.message}
            className={cn(
              "flex items-start gap-2 rounded-xl border p-2.5",
              issue.level === "error"
                ? "border-destructive/40 text-destructive"
                : "border-amber-500/40 text-amber-700 dark:text-amber-400",
            )}
          >
            {issue.level === "error" ? (
              <OctagonX aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            {issue.message}
          </p>
        ))}
        {svg && issues.length === 0 && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-emerald-600" />
            พร้อมใช้งาน สแกนทดสอบก่อนพิมพ์ทุกครั้ง
          </p>
        )}
      </div>
    </>
  );

  const exportButton = (
    <ExportButton
      exportSize={exportSize}
      busy={exporting !== null}
      disabled={blocked || exporting !== null}
      onDownload={(format) => void exportAs(format)}
      onCopy={(format) => void copy(format)}
    />
  );

  // The most pressing thing to know, for the phone bar, which has room for one line.
  const headline: QrIssue | null =
    issues.find((issue) => issue.level === "error") ??
    issues[0] ??
    (failure && failure !== "empty" ? { level: "error", message: FAILURES[failure] } : null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={QrCode}
        title="QR Code"
        description="ออกแบบ QR สำหรับสื่อของงาน ทุกอย่างทำในเบราว์เซอร์ ไม่ส่งข้อมูลออกไปที่ไหน"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        {!compact && (
          <Panel
            icon={ScanQrCode}
            title="ตัวอย่าง"
            description="สิ่งที่เห็นตรงนี้คือไฟล์ที่จะได้"
            label="ตัวอย่าง QR"
            className="lg:sticky lg:top-4 lg:order-2"
          >
            <div className="flex flex-col items-center gap-4">
              {preview}
              {exportButton}
            </div>
          </Panel>
        )}

        <Panel
          icon={QrCode}
          title="ออกแบบ QR"
          description="ใส่ลิงก์หรือข้อความ แล้วปรับรูปทรง สี และโลโก้ให้เข้ากับสื่อ"
          label="ออกแบบ QR"
          action={
            <Button variant="ghost" size="sm" disabled={isDefault} onClick={resetSettings}>
              <RotateCcw data-icon="inline-start" />
              ค่าเริ่มต้น
            </Button>
          }
          className="lg:order-1"
        >
          <FieldGroup>
            <FormSection icon={TextCursorInput} title="เนื้อหา">
              <Field>
                <LabelRow
                  htmlFor="qr-text"
                  label="URL หรือข้อความ"
                  hint="QR เก็บข้อความตามที่พิมพ์ทุกตัวอักษร รวมถึงภาษาไทย ห้ามใส่รหัสผ่าน เบอร์โทร หรือข้อมูลส่วนตัว"
                />
                <Textarea
                  id="qr-text"
                  value={text}
                  rows={3}
                  placeholder="https://it3k.creasy.club"
                  onChange={(event) => setText(event.target.value)}
                />
                <FieldDescription>ยิ่งข้อความสั้น QR ยิ่งโปร่งและสแกนง่าย</FieldDescription>
              </Field>
            </FormSection>

            <FieldSeparator />
            <QrPresetBar current={toPresetDesign(design, exportSize)} onApply={applyPreset} />

            <FieldSeparator />
            <ShapeFields design={design} onChange={change} />

            <FieldSeparator />
            <ColorFields design={design} onChange={change} />

            <FieldSeparator />
            <FormSection icon={ImagePlus} title="โลโก้">
              <div className="grid gap-4 sm:grid-cols-2">
                <OptionSelect
                  id="qr-logo"
                  label="โลโก้กลาง QR"
                  hint="ใช้ไฟล์ PNG, JPG, WebP หรือ SVG ได้ รูปอยู่ในเครื่องนี้เท่านั้น โลโก้บังจุดบางส่วน QR จึงเปลี่ยนไปใช้การกู้คืนข้อมูลระดับ H ให้อัตโนมัติ"
                  options={logoOptions(uploaded?.name ?? null)}
                  value={logoChoice}
                  onChange={chooseLogo}
                />
                <OptionSelect
                  id="qr-logo-size"
                  label="ขนาดโลโก้"
                  options={LOGO_SIZE_OPTIONS}
                  value={String(logoSize)}
                  disabled={logoChoice === "none"}
                  onChange={(size) => resizeLogo(Number(size))}
                />
              </div>
              {/* Opened from the logo select; never shown itself. */}
              <input
                ref={fileInput}
                type="file"
                hidden
                aria-label="ไฟล์โลโก้"
                accept={LOGO_TYPES.join(",")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared so picking the same file again still counts as a change.
                  event.target.value = "";
                  if (file) void uploadLogo(file);
                }}
              />
              {logoLoading && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                  กำลังโหลดโลโก้…
                </p>
              )}
              {logoError && (
                <p role="alert" className="flex items-start gap-2 text-destructive">
                  <OctagonX aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {logoError}
                </p>
              )}
            </FormSection>

            <AdvancedFields
              design={design}
              onChange={change}
              exportSize={exportSize}
              onExportSizeChange={setExportSize}
            />
          </FieldGroup>
        </Panel>
      </div>
      {compact && (
        <>
          <ActionBar
            svg={svg}
            headline={headline}
            onPreview={() => setPreviewOpen(true)}
            exportButton={exportButton}
          />
          <SideDrawer
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            title={
              <span className="flex items-center gap-2">
                <ScanQrCode aria-hidden className="size-5 text-primary" />
                ตัวอย่าง
              </span>
            }
            description="สิ่งที่เห็นตรงนี้คือไฟล์ที่จะได้"
            width="26rem"
          >
            <div className="flex flex-col items-center gap-4 pb-2">
              {preview}
              {exportButton}
            </div>
          </SideDrawer>
        </>
      )}
    </div>
  );
}
