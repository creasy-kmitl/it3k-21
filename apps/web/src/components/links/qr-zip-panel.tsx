import { Button } from "@it3k/ui/components/button";
import { Spinner } from "@it3k/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { FileArchive, FileCode, FileImage, Palette, PencilLine, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { type Option, OptionSelect } from "@/components/qr-design-form";
import { useApis } from "@/lib/api-context";
import { DEFAULT_DESIGN, EXPORT_SIZES, type ExportSize, type QrDesign } from "@/lib/qr";
import { type QrBrowser, qrBrowser } from "@/lib/qr-export";
import { fromPresetDesign } from "@/lib/qr-presets";
import { loadQrSettings } from "@/lib/qr-settings";
import { UnreadableDesignError, type ZipFormat, type ZipLink, buildQrZip } from "@/lib/qr-zip";

const STUDIO = "__studio__";
const PLAIN = "__plain__";

const FORMATS: Option<ZipFormat>[] = [
  { value: "png", label: "PNG ใช้ได้ทั่วไป", icon: FileImage },
  { value: "svg", label: "SVG สำหรับงานพิมพ์", icon: FileCode },
];

/** The design QR Studio last used in this browser, logo included. */
function studioDesign(): { design: QrDesign; exportSize: ExportSize } {
  const saved = loadQrSettings();
  return {
    design: {
      ...saved.design,
      logo:
        saved.logoOn && saved.uploaded
          ? { dataUrl: saved.uploaded.dataUrl, size: saved.logoSize }
          : null,
    },
    exportSize: saved.exportSize,
  };
}

/**
 * Downloads a QR code for every link given, in one zip, drawn with a team
 * preset, the design last used in QR Studio, or plain black on white.
 */
export function QrZipPanel({
  links,
  fileName,
  browser = qrBrowser,
}: {
  links: ZipLink[];
  /** Without `.zip`. */
  fileName: string;
  browser?: QrBrowser;
}) {
  const { qrPresets } = useApis();
  const presets = useQuery({ queryKey: ["qr-presets"], queryFn: () => qrPresets.list() });
  const [source, setSource] = useState(STUDIO);
  const [format, setFormat] = useState<ZipFormat>("png");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const sources: Option<string>[] = [
    { value: STUDIO, label: "ดีไซน์ล่าสุดใน QR Studio", icon: PencilLine },
    { value: PLAIN, label: "ขาวดำ ค่าเริ่มต้น", icon: ShieldCheck },
    ...(presets.data?.items ?? []).map((preset) => ({
      value: preset.id,
      label: preset.name,
      icon: Palette,
    })),
  ];

  function chosenDesign() {
    if (source === STUDIO) return studioDesign();
    const preset = presets.data?.items.find((candidate) => candidate.id === source);
    if (preset) return fromPresetDesign(preset.design);
    return { design: DEFAULT_DESIGN, exportSize: EXPORT_SIZES[1] };
  }

  async function download() {
    setProblem(null);
    setProgress({ done: 0, total: links.length });
    try {
      const { design, exportSize } = chosenDesign();
      const zip = await buildQrZip({
        links,
        design,
        exportSize,
        format,
        rasterize: browser.rasterize,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      browser.download(zip, `${fileName}.zip`);
      toast.success(`ดาวน์โหลด QR ${links.length} อันแล้ว`);
    } catch (error) {
      setProblem(
        error instanceof UnreadableDesignError
          ? `ดีไซน์นี้อาจสแกนไม่ติด: ${error.message}`
          : error instanceof Error
            ? error.message
            : "สร้างไฟล์ไม่สำเร็จ",
      );
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <OptionSelect
          id="zip-design"
          label="ดีไซน์"
          hint="ใช้ preset ของทีม หรือดีไซน์ที่ปรับไว้ล่าสุดในหน้า QR Code บนเครื่องนี้"
          options={sources}
          value={source}
          onChange={setSource}
        />
        <OptionSelect
          id="zip-format"
          label="ชนิดไฟล์"
          options={FORMATS}
          value={format}
          onChange={setFormat}
        />
      </div>
      <p className="text-muted-foreground">
        ได้ไฟล์ละลิงก์ ชื่อไฟล์ตามชื่อท้ายลิงก์ พร้อม links.xlsx บอกว่าไฟล์ไหนคือลิงก์อะไร QR ทุกอันใช้ลิงก์สำหรับ QR
        จึงนับยอดแยกจากการเปิดลิงก์ตรง
      </p>
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <Button disabled={progress !== null || links.length === 0} onClick={() => void download()}>
        {progress ? <Spinner data-icon="inline-start" /> : <FileArchive data-icon="inline-start" />}
        {progress
          ? `กำลังสร้าง ${progress.done}/${progress.total}`
          : `ดาวน์โหลด QR ${links.length} อัน (.zip)`}
      </Button>
    </div>
  );
}
