// QR design presets: the shape the API stores and the web app's QR Studio
// draws. Kept free of Drizzle so the browser bundle can import it.
import { z } from "zod";

export const DOT_STYLES = ["square", "circle", "joined"] as const;
export const MARKER_SHAPES = ["square", "rounded", "circle"] as const;
export const ECC_LEVELS = ["L", "M", "Q", "H"] as const;
export const PRESET_EXPORT_SIZES = [512, 1024, 2048] as const;

export const PRESET_NAME_MAX = 60;
/** QR Studio redraws logos as PNGs of at most 512 px; this leaves room for any of them. */
export const PRESET_LOGO_MAX = 1_000_000;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** A preset's design, as QR Studio's `QrDesign` plus the export size. */
export const presetDesign = z.strictObject({
  dotStyle: z.enum(DOT_STYLES),
  markerBorder: z.enum(MARKER_SHAPES),
  markerCenter: z.enum(MARKER_SHAPES),
  dotColor: hex,
  markerColor: hex,
  background: hex,
  logo: z
    .strictObject({
      // Only a PNG that QR Studio produced; nothing else goes into an SVG.
      dataUrl: z.string().startsWith("data:image/png;base64,").max(PRESET_LOGO_MAX),
      size: z.number().min(0.1).max(0.22),
    })
    .nullable(),
  quietZone: z.number().int().min(4).max(10),
  ecc: z.enum(ECC_LEVELS),
  exportSize: z.union(PRESET_EXPORT_SIZES.map((size) => z.literal(size))),
});

export type PresetDesign = z.infer<typeof presetDesign>;
