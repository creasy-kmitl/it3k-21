// QR Studio's drawing code. Everything here is pure: one SVG string built from
// (text, design) is the preview, the SVG file and the source PNG/JPG are
// rasterized from, so what staff see is exactly what they export.
import { QrCodeDataType, encode } from "uqr";

export type DotStyle = "square" | "circle" | "joined";
export type MarkerShape = "square" | "rounded" | "circle";
export type Ecc = "L" | "M" | "Q" | "H";

/** A logo already normalized to a PNG data URL; `size` is its share of the symbol width. */
export type QrLogo = { dataUrl: string; size: number };

export type QrDesign = {
  dotStyle: DotStyle;
  markerBorder: MarkerShape;
  markerCenter: MarkerShape;
  dotColor: string;
  markerColor: string;
  background: string;
  logo: QrLogo | null;
  /** Blank modules around the symbol; scanners need at least 4. */
  quietZone: number;
  ecc: Ecc;
};

export const QUIET_ZONE_MIN = 4;
export const QUIET_ZONE_MAX = 10;
export const LOGO_SIZE_MIN = 0.1;
/** Past this the logo hides more than error correction level H can recover. */
export const LOGO_SIZE_MAX = 0.22;
export const EXPORT_SIZES = [512, 1024, 2048] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];

// Plain black on white until PR/Art approve an IT3K palette. Change them here only.
export const QR_COLORS = { dark: "#000000", light: "#ffffff" } as const;

export const DEFAULT_DESIGN: QrDesign = {
  dotStyle: "square",
  markerBorder: "rounded",
  markerCenter: "rounded",
  dotColor: QR_COLORS.dark,
  markerColor: QR_COLORS.dark,
  background: QR_COLORS.light,
  logo: null,
  quietZone: QUIET_ZONE_MIN,
  ecc: "M",
};

export type QrMatrix = {
  size: number;
  version: number;
  modules: boolean[][];
  /** Cells of the small alignment patterns, which scanners locate by shape. */
  alignment: boolean[][];
};

export type EncodeFailure = "empty" | "too-long" | "unencodable";
export type EncodeResult = { ok: true; qr: QrMatrix } | { ok: false; reason: EncodeFailure };

/** A logo covers modules, so it always gets the highest error correction. */
export function effectiveEcc(design: Pick<QrDesign, "ecc" | "logo">): Ecc {
  return design.logo ? "H" : design.ecc;
}

/** Encodes the text exactly as typed; nothing is trimmed or rewritten. */
export function encodeQr(text: string, ecc: Ecc): EncodeResult {
  if (text.trim() === "") return { ok: false, reason: "empty" };
  try {
    const { size, version, data, types } = encode(text, { ecc, border: 0 });
    const alignment = types.map((row) => row.map((type) => type === QrCodeDataType.Alignment));
    return { ok: true, qr: { size, version, modules: data, alignment } };
  } catch (error) {
    // uqr throws "Data too long" past version 40, and encodeURI throws on lone
    // surrogates, which have no UTF-8 form.
    if (error instanceof URIError) return { ok: false, reason: "unencodable" };
    if (error instanceof RangeError && /too long/i.test(error.message)) {
      return { ok: false, reason: "too-long" };
    }
    throw error;
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pulls every number back into the range scanners cope with. */
export function normalizeDesign(design: QrDesign): QrDesign {
  return {
    ...design,
    quietZone: Math.round(clamp(design.quietZone, QUIET_ZONE_MIN, QUIET_ZONE_MAX)),
    logo: design.logo
      ? { ...design.logo, size: clamp(design.logo.size, LOGO_SIZE_MIN, LOGO_SIZE_MAX) }
      : null,
    ecc: effectiveEcc(design),
  };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const isHexColor = (value: string) => HEX_COLOR.test(value);

// Numbers in the SVG are module units; three decimals are far below a pixel.
const n = (value: number) => Number(value.toFixed(3)).toString();

function rectPath(x: number, y: number, w: number, h: number) {
  return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
}

function circlePath(cx: number, cy: number, r: number) {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0z`;
}

/** A rectangle whose corners each get radius `r` when their flag is set. */
function roundedPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  [tl, tr, br, bl]: [boolean, boolean, boolean, boolean] = [true, true, true, true],
) {
  const a = (on: boolean) => (on ? r : 0);
  const arc = (on: boolean, dx: number, dy: number) =>
    on ? `a${n(r)} ${n(r)} 0 0 1 ${n(dx)} ${n(dy)}` : "";
  return [
    `M${n(x + a(tl))} ${n(y)}`,
    `h${n(w - a(tl) - a(tr))}`,
    arc(tr, r, r),
    `v${n(h - a(tr) - a(br))}`,
    arc(br, -r, r),
    `h${n(-(w - a(br) - a(bl)))}`,
    arc(bl, -r, -r),
    `v${n(-(h - a(bl) - a(tl)))}`,
    arc(tl, r, -r),
    "z",
  ].join("");
}

function shapePath(shape: MarkerShape, x: number, y: number, size: number, rounding: number) {
  if (shape === "circle") return circlePath(x + size / 2, y + size / 2, size / 2);
  if (shape === "rounded") return roundedPath(x, y, size, size, rounding);
  return rectPath(x, y, size, size);
}

const FINDER = 7;

function inFinder(size: number, x: number, y: number) {
  const near = (v: number) => v < FINDER;
  const far = (v: number) => v >= size - FINDER;
  return (near(x) && near(y)) || (far(x) && near(y)) || (near(x) && far(y));
}

/** The square of modules, centered, that the logo and its one-module margin cover. */
export function logoArea(size: number, logoSize: number) {
  let span = Math.ceil(size * logoSize) + 2;
  // Keep it exactly centered: the gap on each side must be a whole module.
  if ((size - span) % 2 !== 0) span += 1;
  return { start: (size - span) / 2, span };
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Draws an encoded QR code as a self-contained SVG, `px` wide. */
export function renderQrSvg(qr: QrMatrix, design: QrDesign, px: number = EXPORT_SIZES[1]) {
  const d = normalizeDesign(design);
  const { size, modules } = qr;
  const q = d.quietZone;
  const total = size + 2 * q;
  const logo = d.logo ? logoArea(size, d.logo.size) : null;
  const covered = (x: number, y: number) =>
    logo !== null &&
    x >= logo.start &&
    x < logo.start + logo.span &&
    y >= logo.start &&
    y < logo.start + logo.span;
  const dark = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < size &&
    y < size &&
    modules[y][x] &&
    !inFinder(size, x, y) &&
    !covered(x, y);

  const dots: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark(x, y)) continue;
      const left = x + q;
      const top = y + q;
      if (qr.alignment[y][x]) {
        // Scanners find alignment patterns by their solid 1:1:1 ring, which
        // separate dots break, so they stay square in every style.
        dots.push(rectPath(left, top, 1, 1));
      } else if (d.dotStyle === "circle") {
        dots.push(circlePath(left + 0.5, top + 0.5, 0.45));
      } else if (d.dotStyle === "joined") {
        // Round only the corners that face away from every neighbour, so runs
        // of modules flow together into one shape.
        const up = dark(x, y - 1);
        const down = dark(x, y + 1);
        const west = dark(x - 1, y);
        const east = dark(x + 1, y);
        dots.push(
          roundedPath(left, top, 1, 1, 0.5, [
            !up && !west,
            !up && !east,
            !down && !east,
            !down && !west,
          ]),
        );
      } else {
        dots.push(rectPath(left, top, 1, 1));
      }
    }
  }

  const markers: string[] = [];
  for (const [fx, fy] of [
    [0, 0],
    [size - FINDER, 0],
    [0, size - FINDER],
  ]) {
    const x = fx + q;
    const y = fy + q;
    markers.push(
      shapePath(d.markerBorder, x, y, 7, 2) + shapePath(d.markerBorder, x + 1, y + 1, 5, 1.2),
    );
    markers.push(shapePath(d.markerCenter, x + 2, y + 2, 3, 0.8));
  }

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}">`,
    `<rect width="${total}" height="${total}" fill="${d.background}"/>`,
    `<path fill="${d.dotColor}" d="${dots.join("")}"/>`,
    // The ring is the outer shape with the inner one cut out.
    `<path fill="${d.markerColor}" fill-rule="evenodd" d="${markers.join("")}"/>`,
  ];
  if (d.logo && logo) {
    const inner = logo.span - 2;
    const at = logo.start + 1 + q;
    parts.push(
      `<image href="${escapeAttr(d.logo.dataUrl)}" x="${at}" y="${at}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

export const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function luminance(hex: string) {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #rrggbb colours, from 1 to 21. */
export function contrastRatio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const CONTRAST_BLOCK = 3;
export const CONTRAST_WARN = 4.5;

export type QrIssue = { level: "error" | "warning"; message: string };

/** What might stop the design scanning. Errors block export; warnings only advise. */
export function assessQr(design: QrDesign, qr: QrMatrix, exportSize: number): QrIssue[] {
  const d = normalizeDesign(design);
  const issues: QrIssue[] = [];
  const colors = [d.dotColor, d.markerColor, d.background];
  if (!colors.every(isHexColor)) {
    return [{ level: "error", message: "สีต้องอยู่ในรูปแบบ #RRGGBB" }];
  }

  const worst = Math.min(
    contrastRatio(d.dotColor, d.background),
    contrastRatio(d.markerColor, d.background),
  );
  if (worst < CONTRAST_BLOCK) {
    issues.push({
      level: "error",
      message: "สีของ QR กับพื้นหลังใกล้กันเกินไป เครื่องสแกนจะอ่านไม่ออก",
    });
  } else if (worst < CONTRAST_WARN) {
    issues.push({
      level: "warning",
      message: "สีของ QR กับพื้นหลังต่างกันไม่มาก อาจสแกนยากในที่แสงน้อยหรือเมื่อพิมพ์",
    });
  }

  const bg = luminance(d.background);
  if (luminance(d.dotColor) > bg || luminance(d.markerColor) > bg) {
    issues.push({
      level: "warning",
      message: "QR สีอ่อนบนพื้นเข้มอ่านไม่ได้ในบางแอป ควรใช้สีเข้มบนพื้นอ่อน",
    });
  }
  if (d.logo && qr.version > 10) {
    issues.push({
      level: "warning",
      message: "ข้อมูลยาวและมีโลโก้ QR จะหนาแน่นมาก ลองย่อโลโก้หรือทำข้อความให้สั้นลง",
    });
  } else if (qr.version > 15) {
    issues.push({
      level: "warning",
      message: "ข้อมูลยาวมาก QR จะหนาแน่น ควรพิมพ์ขนาดใหญ่หรือทำข้อความให้สั้นลง",
    });
  }
  if (exportSize / (qr.size + 2 * d.quietZone) < 4) {
    issues.push({
      level: "warning",
      message: "ขนาดไฟล์เล็กเกินไปสำหรับข้อมูลนี้ แต่ละจุดจะเล็กกว่า 4 พิกเซล ควรเลือกขนาดที่ใหญ่ขึ้น",
    });
  }
  return issues;
}

// Characters Windows, macOS or shells refuse or misread in a file name, plus
// control characters, which are checked by code point.
const UNSAFE_NAME = /[<>:"/\\|?*]+/g;
const isControl = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
};

/** `it3k-qr-<what it encodes>.<ext>`, safe to save on any OS. */
export function qrFileName(text: string, ext: "png" | "svg" | "jpg") {
  let source = text;
  try {
    const url = new URL(text);
    if (url.hostname) source = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    // Not a URL; name it after the text itself.
  }
  const slug = Array.from(source.normalize("NFC"), (char) => (isControl(char) ? "-" : char))
    .join("")
    .replace(UNSAFE_NAME, "-")
    .replace(/[\s.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = Array.from(slug).slice(0, 50).join("").replace(/-+$/, "");
  return `${cut ? `it3k-qr-${cut}` : "it3k-qr"}.${ext}`;
}

const graphemes = (text: string) =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );

/**
 * A file name cut in the middle to at most `max` characters, keeping its
 * extension so the kind of file still shows. Cuts fall between whole
 * characters, so Thai vowels and tone marks stay on their letters.
 */
export function shortFileName(name: string, max = 24) {
  const chars = graphemes(name);
  if (chars.length <= max) return name;
  const dot = name.lastIndexOf(".");
  // Only a short suffix counts as an extension; "a.very-long-part" does not.
  const ext = dot > 0 && name.length - dot <= 6 ? graphemes(name.slice(dot)) : [];
  const tail = Math.max(ext.length + 4, Math.floor((max - 1) / 3));
  const head = max - 1 - tail;
  return `${chars.slice(0, head).join("")}…${chars.slice(-tail).join("")}`;
}
