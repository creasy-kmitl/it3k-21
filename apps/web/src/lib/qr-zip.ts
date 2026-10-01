// Many QR codes at once: one file per short link, plus a spreadsheet that
// says which file is which, packed into a zip in the browser.
import { strToU8, zipSync } from "fflate";

import { toXlsx } from "./xlsx";
import {
  type ExportSize,
  type QrDesign,
  assessQr,
  encodeQr,
  normalizeDesign,
  renderQrSvg,
} from "./qr";
import type { QrBrowser } from "./qr-export";

export type ZipFormat = "png" | "svg";

export type ZipLink = { slug: string; title: string; qrUrl: string; shortUrl: string };

/** A design that cannot be drawn readably stops the export, with QR Studio's reason. */
export class UnreadableDesignError extends Error {}

export async function buildQrZip({
  links,
  design,
  exportSize,
  format,
  rasterize,
  onProgress,
}: {
  links: ZipLink[];
  design: QrDesign;
  exportSize: ExportSize;
  format: ZipFormat;
  rasterize: QrBrowser["rasterize"];
  onProgress?: (done: number, total: number) => void;
}): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const ecc = normalizeDesign(design).ecc;
  for (const [i, link] of links.entries()) {
    const encoded = encodeQr(link.qrUrl, ecc);
    if (!encoded.ok) throw new Error(`สร้าง QR ของ ${link.slug} ไม่ได้`);
    const blocking = assessQr(design, encoded.qr, exportSize).find(
      (issue) => issue.level === "error",
    );
    if (blocking) throw new UnreadableDesignError(blocking.message);
    const svg = renderQrSvg(encoded.qr, design, exportSize);
    files[`${link.slug}.${format}`] =
      format === "svg"
        ? strToU8(svg)
        : new Uint8Array(await (await rasterize(svg, "image/png", exportSize)).arrayBuffer());
    onProgress?.(i + 1, links.length);
  }
  // A spreadsheet, so titles stay text in Excel (see xlsx.ts).
  files["links.xlsx"] = toXlsx("links", [
    ["file", "title", "qr_url", "short_url"],
    ...links.map((link) => [`${link.slug}.${format}`, link.title, link.qrUrl, link.shortUrl]),
  ]);
  // Images are compressed already; storing them keeps the browser quick.
  const zipped = zipSync(files, { level: format === "svg" ? 6 : 0 });
  return new Blob([zipped], { type: "application/zip" });
}
