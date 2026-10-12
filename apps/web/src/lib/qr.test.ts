import { describe, expect, test } from "bun:test";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";

import {
  DEFAULT_DESIGN,
  LOGO_SIZE_MAX,
  QUIET_ZONE_MIN,
  type DotStyle,
  type MarkerShape,
  type QrDesign,
  assessQr,
  contrastRatio,
  encodeQr,
  logoArea,
  normalizeDesign,
  qrFileName,
  renderQrSvg,
  shortFileName,
} from "./qr";

function encoded(text: string, design: QrDesign = DEFAULT_DESIGN) {
  const result = encodeQr(text, normalizeDesign(design).ecc);
  if (!result.ok) throw new Error(`could not encode: ${result.reason}`);
  return result.qr;
}

/** Rasterizes the exported SVG and reads it back the way a phone camera would. */
function scan(svg: string) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 600 } }).render();
  const code = jsQR(new Uint8ClampedArray(png.pixels), png.width, png.height);
  return code ? new TextDecoder().decode(new Uint8Array(code.binaryData)) : null;
}

// A 64×64 solid square, standing in for a logo that hides everything under it.
const LOGO =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#c10007"/></svg>',
  );

const URL_TEXT = "https://it3k.creasy.club/staff/calendar?utm_source=poster";
const THAI_TEXT = "ลงทะเบียนนักกีฬา IT3K ครั้งที่ 21 — จุดรับบัตร ตึก ECC";

describe("encodeQr", () => {
  test("rejects blank input", () => {
    expect(encodeQr("", "M")).toEqual({ ok: false, reason: "empty" });
    expect(encodeQr("   \n", "M")).toEqual({ ok: false, reason: "empty" });
  });

  test("rejects text past QR's capacity", () => {
    expect(encodeQr("ก".repeat(3000), "M")).toEqual({ ok: false, reason: "too-long" });
  });

  test("rejects text with no UTF-8 form", () => {
    expect(encodeQr("bad \ud800 surrogate", "M")).toEqual({ ok: false, reason: "unencodable" });
  });

  test("keeps surrounding whitespace in the data", () => {
    const padded = encoded(" hi ");
    const bare = encoded("hi");
    expect(padded.modules).not.toEqual(bare.modules);
  });
});

describe("normalizeDesign", () => {
  test("forces error correction H while there is a logo", () => {
    expect(normalizeDesign({ ...DEFAULT_DESIGN, ecc: "L" }).ecc).toBe("L");
    expect(
      normalizeDesign({ ...DEFAULT_DESIGN, ecc: "L", logo: { dataUrl: LOGO, size: 0.2 } }).ecc,
    ).toBe("H");
  });

  test("clamps the quiet zone and logo size", () => {
    const d = normalizeDesign({
      ...DEFAULT_DESIGN,
      quietZone: 1,
      logo: { dataUrl: LOGO, size: 0.5 },
    });
    expect(d.quietZone).toBe(QUIET_ZONE_MIN);
    expect(d.logo?.size).toBe(LOGO_SIZE_MAX);
  });

  test("keeps the logo area centered", () => {
    for (const size of [21, 25, 57]) {
      const { start, span } = logoArea(size, LOGO_SIZE_MAX);
      expect(start * 2 + span).toBe(size);
    }
  });
});

describe("renderQrSvg", () => {
  test("changes with every style option", () => {
    const qr = encoded(URL_TEXT);
    const base = renderQrSvg(qr, DEFAULT_DESIGN);
    for (const change of [
      { dotStyle: "circle" },
      { markerBorder: "circle" },
      { markerCenter: "square" },
      { dotColor: "#003366" },
      { markerColor: "#003366" },
      { background: "#fffbe6" },
      { quietZone: 6 },
    ] satisfies Partial<QrDesign>[]) {
      expect(renderQrSvg(qr, { ...DEFAULT_DESIGN, ...change })).not.toBe(base);
    }
  });

  test("sizes the file to the export width", () => {
    const svg = renderQrSvg(encoded("x"), DEFAULT_DESIGN, 2048);
    expect(svg).toContain('width="2048" height="2048"');
  });

  test("escapes the logo URL", () => {
    const design = { ...DEFAULT_DESIGN, logo: { dataUrl: 'data:x"><script>', size: 0.2 } };
    const svg = renderQrSvg(encoded("x", design), design);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('href="data:x&quot;>&lt;script>"');
  });
});

describe("scans back to the exact text", () => {
  const dots: DotStyle[] = ["square", "circle", "joined"];
  const shapes: MarkerShape[] = ["square", "rounded", "circle"];

  for (const text of [URL_TEXT, THAI_TEXT]) {
    for (const dotStyle of dots) {
      for (const marker of shapes) {
        test(`${text.slice(0, 12)}… with ${dotStyle} dots and ${marker} markers`, () => {
          const design = {
            ...DEFAULT_DESIGN,
            dotStyle,
            markerBorder: marker,
            markerCenter: marker,
          };
          expect(scan(renderQrSvg(encoded(text, design), design))).toBe(text);
        });
      }
    }

    test(`${text.slice(0, 12)}… with the largest logo`, () => {
      const design = { ...DEFAULT_DESIGN, logo: { dataUrl: LOGO, size: LOGO_SIZE_MAX } };
      expect(scan(renderQrSvg(encoded(text, design), design))).toBe(text);
    });
  }
});

describe("assessQr", () => {
  const qr = encoded(URL_TEXT);
  const levels = (design: QrDesign, size = 1024) =>
    assessQr(design, qr, size).map((issue) => issue.level);

  test("passes the default design", () => {
    expect(assessQr(DEFAULT_DESIGN, qr, 1024)).toEqual([]);
  });

  test("blocks colours scanners cannot tell apart", () => {
    expect(contrastRatio("#bbbbbb", "#ffffff")).toBeLessThan(3);
    expect(levels({ ...DEFAULT_DESIGN, dotColor: "#bbbbbb" })).toContain("error");
    expect(levels({ ...DEFAULT_DESIGN, markerColor: "#bbbbbb" })).toContain("error");
  });

  test("warns on middling contrast and on inverted colours", () => {
    expect(levels({ ...DEFAULT_DESIGN, dotColor: "#888888" })).toEqual(["warning"]);
    expect(
      levels({
        ...DEFAULT_DESIGN,
        dotColor: "#ffffff",
        markerColor: "#ffffff",
        background: "#000000",
      }),
    ).toEqual(["warning"]);
  });

  test("blocks colours that are not #rrggbb", () => {
    expect(levels({ ...DEFAULT_DESIGN, dotColor: "red" })).toEqual(["error"]);
  });

  test("warns when modules would be under 4 px", () => {
    const dense = encoded("x".repeat(1500));
    expect(
      assessQr(DEFAULT_DESIGN, dense, 512)
        .map((i) => i.message)
        .join(),
    ).toContain("4 พิกเซล");
  });
});

describe("qrFileName", () => {
  test("names URLs after host and path", () => {
    expect(qrFileName("https://it3k.creasy.club/", "png")).toBe("it3k-qr-it3k-creasy-club.png");
    expect(qrFileName("https://example.com/a/b?c=1", "svg")).toBe("it3k-qr-example-com-a-b.svg");
  });

  test("keeps Thai and drops characters file systems refuse", () => {
    expect(qrFileName('ลงทะเบียน: <ด่วน> "IT3K"?', "jpg")).toBe("it3k-qr-ลงทะเบียน-ด่วน-IT3K.jpg");
  });

  test("replaces control characters", () => {
    expect(qrFileName("a\u0007b\u007fc", "png")).toBe("it3k-qr-a-b-c.png");
  });

  test("falls back when nothing usable is left", () => {
    expect(qrFileName("///", "png")).toBe("it3k-qr.png");
  });

  test("caps the length", () => {
    const name = qrFileName("ก".repeat(200), "png");
    expect(Array.from(name).length).toBeLessThanOrEqual("it3k-qr-".length + 50 + ".png".length);
  });
});

describe("shortFileName", () => {
  test("leaves short names alone", () => {
    expect(shortFileName("logo.png")).toBe("logo.png");
  });

  test("cuts the middle and keeps the extension", () => {
    const short = shortFileName("IT3K-official-logo-final-final-v3-approved.png");
    expect(short).toBe("IT3K-official-l…oved.png");
    expect(Array.from(short)).toHaveLength(24);
  });

  test("never splits a Thai vowel or tone mark from its letter", () => {
    const short = shortFileName("โลโก้ใหม่ของฝ่ายประชาสัมพันธ์ที่อนุมัติแล้ว.png", 16);
    const [head = "", tail = ""] = short.split("…");
    // Each side must start and end on a whole character, not a lone combining mark.
    for (const part of [head, tail]) {
      expect(part.normalize("NFC")).toBe(part);
      expect(/^[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/.test(part)).toBe(false);
    }
    expect(tail.endsWith(".png")).toBe(true);
  });

  test("handles names with no extension", () => {
    const short = shortFileName("a".repeat(40));
    expect(short).toBe(`${"a".repeat(16)}…${"a".repeat(7)}`);
  });
});
