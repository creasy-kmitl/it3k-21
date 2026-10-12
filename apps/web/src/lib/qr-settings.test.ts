import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS, loadQrSettings, saveQrSettings } from "./qr-settings";

const KEY = "it3k:qr-studio";

afterEach(() => window.localStorage.clear());

describe("QR settings", () => {
  test("round-trips what was saved", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      design: { ...DEFAULT_SETTINGS.design, dotStyle: "joined" as const, quietZone: 8 },
      uploaded: { name: "mark.png", dataUrl: "data:image/png;base64,AAAA" },
      logoOn: true,
    };
    saveQrSettings(settings);
    expect(loadQrSettings()).toEqual(settings);
  });

  test("gives the defaults when nothing is saved", () => {
    expect(loadQrSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("only accepts a logo that is a PNG data URL", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        uploaded: { name: "x.svg", dataUrl: "data:image/svg+xml,<svg onload=alert(1)>" },
        logoOn: true,
      }),
    );
    const loaded = loadQrSettings();
    expect(loaded.uploaded).toBeNull();
    // With no usable logo, the logo cannot be on.
    expect(loaded.logoOn).toBe(false);
  });

  test("rejects values outside what the studio offers", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        design: { quietZone: 1, dotColor: "red", ecc: "Z" },
        logoSize: 0.9,
        exportSize: 4096,
      }),
    );
    const loaded = loadQrSettings();
    expect(loaded.design.quietZone).toBe(DEFAULT_SETTINGS.design.quietZone);
    expect(loaded.design.dotColor).toBe(DEFAULT_SETTINGS.design.dotColor);
    expect(loaded.design.ecc).toBe(DEFAULT_SETTINGS.design.ecc);
    expect(loaded.logoSize).toBe(DEFAULT_SETTINGS.logoSize);
    expect(loaded.exportSize).toBe(DEFAULT_SETTINGS.exportSize);
  });
});
