import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";

import { DEFAULT_DESIGN } from "./qr";
import { UnreadableDesignError, buildQrZip } from "./qr-zip";

const links = [
  {
    slug: "rov",
    title: "บูธ ROV",
    qrUrl: "https://it3k.test/l/rov?qr",
    shortUrl: "https://it3k.test/l/rov",
  },
  {
    slug: "valo",
    title: "บูธ, Valo",
    qrUrl: "https://it3k.test/l/valo?qr",
    shortUrl: "https://it3k.test/l/valo",
  },
];

const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe("buildQrZip", () => {
  test("one SVG per link, drawn for the QR URL, and a CSV index", async () => {
    const progress: number[] = [];
    const zip = await buildQrZip({
      links,
      design: DEFAULT_DESIGN,
      exportSize: 1024,
      format: "svg",
      rasterize: async () => {
        throw new Error("SVG needs no canvas");
      },
      onProgress: (done) => progress.push(done),
    });
    const files = await unzip(zip);
    expect(Object.keys(files).sort()).toEqual(["links.csv", "rov.svg", "valo.svg"]);
    expect(strFromU8(defined(files["rov.svg"]))).toStartWith("<svg");
    expect(strFromU8(defined(files["links.csv"]))).toContain('valo.svg,"บูธ, Valo"');
    expect(progress).toEqual([1, 2]);
  });

  test("PNGs come from the browser's rasterizer at the export size", async () => {
    const sizes: number[] = [];
    const zip = await buildQrZip({
      links,
      design: DEFAULT_DESIGN,
      exportSize: 2048,
      format: "png",
      rasterize: async (_svg, type, px) => {
        sizes.push(px);
        return new Blob(["png"], { type });
      },
    });
    const files = await unzip(zip);
    expect(strFromU8(defined(files["rov.png"]))).toBe("png");
    expect(sizes).toEqual([2048, 2048]);
  });

  test("refuses a design that would not scan", async () => {
    await expect(
      buildQrZip({
        links,
        design: { ...DEFAULT_DESIGN, dotColor: "#f5f5f5" },
        exportSize: 1024,
        format: "svg",
        rasterize: async () => new Blob(),
      }),
    ).rejects.toBeInstanceOf(UnreadableDesignError);
  });
});

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing file");
  return value;
}
