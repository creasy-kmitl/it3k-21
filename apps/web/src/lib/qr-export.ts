// QR Studio's browser side: turning the SVG into files, the clipboard and
// logos. Everything stays on the device; nothing is sent to a QR service.

export type RasterType = "image/png" | "image/jpeg";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_MAX_PX = 512;

function loadImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("โหลดรูปไม่สำเร็จ"));
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("เบราว์เซอร์นี้วาดรูปไม่ได้");
  return { canvas, context };
}

function toBlob(canvas: HTMLCanvasElement, type: RasterType) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("สร้างไฟล์รูปไม่สำเร็จ"))),
      type,
      0.92,
    ),
  );
}

/** Draws the SVG onto a `px` square canvas. Its background is opaque, so JPG matches PNG. */
export async function rasterize(svg: string, type: RasterType, px: number) {
  const image = await loadImage(new Blob([svg], { type: "image/svg+xml" }));
  const { canvas, context } = canvasOf(px, px);
  context.drawImage(image, 0, 0, px, px);
  return toBlob(canvas, type);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canCopyImage() {
  return typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";
}

/** Copies a PNG. Returns false when the browser cannot put images on the clipboard. */
export async function copyPng(png: () => Promise<Blob>) {
  if (!canCopyImage()) return false;
  // Safari only keeps the click's permission if the item is created right
  // away, with the image still on its way.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png() })]);
  return true;
}

/**
 * Copies text, such as SVG markup that Figma or Illustrator paste as vectors.
 * Returns false when the browser has no clipboard to write to.
 */
export async function copyText(text: string) {
  if (typeof navigator.clipboard?.writeText !== "function") return false;
  await navigator.clipboard.writeText(text);
  return true;
}

/**
 * Reads a logo and redraws it as a PNG data URL of at most 512 px. Redrawing
 * drops anything active in an uploaded SVG and keeps exported SVGs self-contained.
 * Any file size is fine: it all stays on this device, and the result is small.
 */
export async function loadLogo(file: Blob) {
  if (!LOGO_TYPES.includes(file.type)) throw new Error("ใช้ได้เฉพาะไฟล์ PNG, JPG, WebP หรือ SVG");
  const image = await loadImage(file);
  // An SVG without width and height has no natural size in some browsers.
  const width = image.naturalWidth || LOGO_MAX_PX;
  const height = image.naturalHeight || LOGO_MAX_PX;
  const scale = Math.min(1, LOGO_MAX_PX / Math.max(width, height));
  const { canvas, context } = canvasOf(
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  );
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export type QrBrowser = {
  rasterize: typeof rasterize;
  download: typeof downloadBlob;
  copyPng: typeof copyPng;
  copyText: typeof copyText;
  loadLogo: typeof loadLogo;
};

export const qrBrowser: QrBrowser = {
  rasterize,
  download: downloadBlob,
  copyPng,
  copyText,
  loadLogo,
};
