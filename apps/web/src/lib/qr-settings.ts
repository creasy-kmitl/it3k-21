// QR Studio remembers its settings in this browser, so staff pick up where
// they left off. The text being encoded is left out on purpose: it may be a
// private link, and settings are what people reuse.
import { z } from "zod";

import {
  DEFAULT_DESIGN,
  EXPORT_SIZES,
  type ExportSize,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  QUIET_ZONE_MAX,
  QUIET_ZONE_MIN,
  type QrDesign,
  isHexColor,
} from "@/lib/qr";

const KEY = "it3k:qr-studio";

export const DEFAULT_LOGO_SIZE = 0.18;

export type UploadedLogo = { name: string; dataUrl: string };

export type QrSettings = {
  /** The design without its logo; the logo is `uploaded` while `logoOn`. */
  design: Omit<QrDesign, "logo">;
  exportSize: ExportSize;
  logoSize: number;
  uploaded: UploadedLogo | null;
  logoOn: boolean;
};

const { logo: _logo, ...DEFAULT_DESIGN_FIELDS } = DEFAULT_DESIGN;

export const DEFAULT_SETTINGS: QrSettings = {
  design: DEFAULT_DESIGN_FIELDS,
  exportSize: EXPORT_SIZES[1],
  logoSize: DEFAULT_LOGO_SIZE,
  uploaded: null,
  logoOn: false,
};

const d = DEFAULT_SETTINGS.design;
const color = (fallback: string) => z.string().refine(isHexColor).catch(fallback);

// Every field falls back on its own, so one stale or hand-edited value does
// not throw away the rest.
const schema = z.object({
  design: z
    .object({
      dotStyle: z.enum(["square", "circle", "joined"]).catch(d.dotStyle),
      markerBorder: z.enum(["square", "rounded", "circle"]).catch(d.markerBorder),
      markerCenter: z.enum(["square", "rounded", "circle"]).catch(d.markerCenter),
      dotColor: color(d.dotColor),
      markerColor: color(d.markerColor),
      background: color(d.background),
      quietZone: z.number().int().min(QUIET_ZONE_MIN).max(QUIET_ZONE_MAX).catch(d.quietZone),
      ecc: z.enum(["L", "M", "Q", "H"]).catch(d.ecc),
    })
    .catch(d),
  exportSize: z
    .number()
    .refine((px): px is ExportSize => (EXPORT_SIZES as readonly number[]).includes(px))
    .catch(DEFAULT_SETTINGS.exportSize),
  logoSize: z.number().min(LOGO_SIZE_MIN).max(LOGO_SIZE_MAX).catch(DEFAULT_LOGO_SIZE),
  // Only a PNG that loadLogo produced; nothing else goes into the SVG.
  uploaded: z
    .object({ name: z.string(), dataUrl: z.string().startsWith("data:image/png;base64,") })
    .nullable()
    .catch(null),
  logoOn: z.boolean().catch(false),
});

/** The saved settings, or the defaults when there are none or they are unreadable. */
export function loadQrSettings(): QrSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const settings = schema.parse(JSON.parse(raw)) as QrSettings;
    return { ...settings, logoOn: settings.logoOn && settings.uploaded !== null };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Saves the settings; a full or blocked storage only means they are not remembered. */
export function saveQrSettings(settings: QrSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode or over quota (a large logo): keep working without saving.
  }
}

export function clearQrSettings() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing saved to clear.
  }
}
