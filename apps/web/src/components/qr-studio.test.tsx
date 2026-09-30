import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { QrBrowser, RasterType } from "@/lib/qr-export";
import { choose } from "@/test/query";

import { QrStudio } from "./qr-studio";

afterEach(() => {
  cleanup();
  // Settings persist in localStorage; each test starts from a first visit.
  window.localStorage.clear();
});

const PNG_URL = "data:image/png;base64,iVBORw0KGgo=";

function setup(overrides: Partial<QrBrowser> = {}) {
  const downloads: { name: string; blob: Blob }[] = [];
  const rasterized: { type: RasterType; px: number }[] = [];
  const browser: QrBrowser = {
    rasterize: async (_svg, type, px) => {
      rasterized.push({ type, px });
      return new Blob(["raster"], { type });
    },
    download: (blob, name) => void downloads.push({ blob, name }),
    copyPng: async () => true,
    copyText: async () => true,
    loadLogo: async () => PNG_URL,
    ...overrides,
  };
  render(<QrStudio browser={browser} />);
  return { downloads, rasterized };
}

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText("URL หรือข้อความ"), { target: { value: text } });

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

/** Picks "upload" from the logo select, then hands the picker a file. */
async function upload(name = "logo.png", option: string = "อัปโหลดรูป…") {
  await choose(screen.getByLabelText("โลโก้กลาง QR"), option);
  const file = new File(["x"], name, { type: "image/png" });
  fireEvent.change(screen.getByLabelText("ไฟล์โลโก้"), { target: { files: [file] } });
}

/** Opens the export menu and picks the item whose title starts with `item`. */
async function pick(item: string) {
  fireEvent.click(button("ตัวเลือกดาวน์โหลดและคัดลอก"));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^${item}`) }));
}

/** The SVG the preview shows, decoded from its data URL. */
function previewSvg() {
  const img = screen.getByRole("img", { name: /^QR code ของ/ }) as HTMLImageElement;
  return decodeURIComponent(img.getAttribute("src")?.split(",")[1] ?? "");
}

describe("QrStudio", () => {
  test("asks for input and keeps export off while it is empty", () => {
    setup();
    expect(screen.getByText("กรอก URL หรือข้อความเพื่อสร้าง QR")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /^QR code ของ/ })).toBeNull();
    for (const name of ["ดาวน์โหลด PNG", "ตัวเลือกดาวน์โหลดและคัดลอก"]) {
      expect(button(name).disabled).toBe(true);
    }
  });

  test("reports text too long for a QR code", () => {
    setup();
    type("ก".repeat(3000));
    expect(screen.getByText(/ยาวเกินกว่าที่ QR จะเก็บได้/)).toBeTruthy();
    expect(button("ดาวน์โหลด PNG").disabled).toBe(true);
  });

  test("the SVG download is the preview of the latest input", async () => {
    const { downloads } = setup();
    type("draft");
    const first = previewSvg();
    type("https://example.com/poster");
    expect(previewSvg()).not.toBe(first);
    expect(
      screen.getByRole("img", { name: "QR code ของ https://example.com/poster" }),
    ).toBeTruthy();

    await pick("SVG");
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe("it3k-qr-example-com-poster.svg");
    expect(await downloads[0]?.blob.text()).toBe(previewSvg());
  });

  test("style and colour changes reach the preview", async () => {
    setup();
    type("https://example.com");
    const before = previewSvg();
    await choose(screen.getByLabelText("รูปแบบจุด"), "วงกลม");
    const circles = previewSvg();
    expect(circles).not.toBe(before);

    fireEvent.change(screen.getByLabelText("สีจุด"), { target: { value: "#003366" } });
    expect(previewSvg()).toContain('fill="#003366"');
  });

  test("blocks export when the colours are too close", () => {
    setup();
    type("https://example.com");
    fireEvent.change(screen.getByLabelText("สีจุด"), { target: { value: "#dddddd" } });
    expect(screen.getByText(/ใกล้กันเกินไป/)).toBeTruthy();
    expect(button("ดาวน์โหลด PNG").disabled).toBe(true);
    expect(button("ตัวเลือกดาวน์โหลดและคัดลอก").disabled).toBe(true);
  });

  test("ignores a half-typed colour", () => {
    setup();
    type("https://example.com");
    const before = previewSvg();
    fireEvent.change(screen.getByLabelText("สีพื้นหลัง"), { target: { value: "#ff" } });
    expect(previewSvg()).toBe(before);
    expect(screen.getByLabelText("สีพื้นหลัง").getAttribute("aria-invalid")).toBe("true");
  });

  test("a swatch from the colour picker reaches the preview", async () => {
    setup();
    type("https://example.com");
    fireEvent.click(screen.getByRole("button", { name: "เลือกสีจุด" }));
    fireEvent.click(await screen.findByRole("button", { name: "น้ำเงินเข้ม" }));
    expect(previewSvg()).toContain('fill="#1e3a8a"');
    expect((screen.getByLabelText("สีจุด") as HTMLInputElement).value).toBe("#1e3a8a");
  });

  test("PNG and JPG are rasterized at the chosen size", async () => {
    const { downloads, rasterized } = setup();
    type("hello");
    fireEvent.click(button("ตั้งค่าขั้นสูง (ไม่บังคับ)"));
    await choose(screen.getByLabelText("ขนาดไฟล์ PNG/JPG"), "2048 × 2048 px");
    expect(screen.getByText("ปรับแล้ว 1")).toBeTruthy();
    fireEvent.click(button("ตัวเลือกดาวน์โหลดและคัดลอก"));
    // The menu says what size the raster files come out at.
    expect(await screen.findByText("รูปภาพ 2048 px ใช้ได้ทั่วไป")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /^PNG/ }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    // Buttons wait while a file is being made, then come back.
    await waitFor(() => expect(button("ตัวเลือกดาวน์โหลดและคัดลอก").disabled).toBe(false));
    await pick("JPG");
    await waitFor(() => expect(downloads).toHaveLength(2));
    expect(rasterized).toEqual([
      { type: "image/png", px: 2048 },
      { type: "image/jpeg", px: 2048 },
    ]);
    expect(downloads.map((d) => d.name)).toEqual(["it3k-qr-hello.png", "it3k-qr-hello.jpg"]);
  });

  test("the main button downloads a PNG in one click", async () => {
    const { downloads, rasterized } = setup();
    type("hello");
    const group = screen.getByRole("group", { name: "ส่งออก QR" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["ดาวน์โหลด PNG", "ตัวเลือกดาวน์โหลดและคัดลอก"]);
    fireEvent.click(button("ดาวน์โหลด PNG"));
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual(["it3k-qr-hello.png"]));
    expect(rasterized).toEqual([{ type: "image/png", px: 1024 }]);
  });

  test("copy falls back to a PNG download where the clipboard cannot take images", async () => {
    const { downloads } = setup({ copyPng: async () => false });
    type("hello");
    await pick("รูป PNG");
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual(["it3k-qr-hello.png"]));
  });

  test("copy does not download when it works", async () => {
    let copied = 0;
    const { downloads } = setup({
      copyPng: async (png) => {
        await png();
        copied++;
        return true;
      },
    });
    type("hello");
    await pick("รูป PNG");
    await waitFor(() => expect(copied).toBe(1));
    expect(downloads).toEqual([]);
  });

  test("copies SVG as the same markup the preview shows", async () => {
    const texts: string[] = [];
    const { downloads } = setup({
      copyText: async (text) => {
        texts.push(text);
        return true;
      },
    });
    type("hello");
    await pick("โค้ด SVG");
    await waitFor(() => expect(texts).toEqual([previewSvg()]));
    expect(downloads).toEqual([]);
  });

  test("SVG copy falls back to an SVG download without a clipboard", async () => {
    const { downloads } = setup({ copyText: async () => false });
    type("hello");
    await pick("โค้ด SVG");
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual(["it3k-qr-hello.svg"]));
    expect(await downloads[0]?.blob.text()).toBe(previewSvg());
  });

  test("a logo locks error correction to H", async () => {
    setup();
    type("https://example.com");
    await upload();
    await waitFor(() => expect(previewSvg()).toContain(`href="${PNG_URL}"`));
    expect(screen.getByText("ใช้ระดับ H เสมอเมื่อมีโลโก้")).toBeTruthy();
  });

  test("a slow logo does not return after it was removed", async () => {
    let finish: (url: string) => void = () => {};
    setup({ loadLogo: () => new Promise((resolve) => (finish = resolve)) });
    type("https://example.com");
    await upload();
    await choose(screen.getByLabelText("โลโก้กลาง QR"), "ไม่มีโลโก้");
    await act(async () => finish(PNG_URL));
    expect(previewSvg()).not.toContain("<image");
  });

  test("shows why an uploaded logo was refused", async () => {
    setup({
      loadLogo: async () => {
        throw new Error("ใช้ได้เฉพาะไฟล์ PNG, JPG, WebP หรือ SVG");
      },
    });
    type("https://example.com");
    await upload();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "ใช้ได้เฉพาะไฟล์ PNG, JPG, WebP หรือ SVG",
    );
    expect(previewSvg()).not.toContain("<image");
  });

  test("picking upload opens the file picker instead of showing a field", async () => {
    const clicks = spyOn(HTMLInputElement.prototype, "click");
    try {
      setup();
      type("https://example.com");
      await choose(screen.getByLabelText("โลโก้กลาง QR"), "อัปโหลดรูป…");
      expect(clicks).toHaveBeenCalledTimes(1);
      expect(clicks.mock.contexts[0]).toBe(screen.getByLabelText("ไฟล์โลโก้"));
    } finally {
      clicks.mockRestore();
    }
  });

  test("the uploaded file stays a choice after switching the logo off", async () => {
    setup();
    type("https://example.com");
    await upload("mark.png");
    await waitFor(() => expect(previewSvg()).toContain(`href="${PNG_URL}"`));
    expect(screen.getByLabelText("โลโก้กลาง QR").textContent).toContain("mark.png");

    await choose(screen.getByLabelText("โลโก้กลาง QR"), "ไม่มีโลโก้");
    expect(previewSvg()).not.toContain("<image");
    await choose(screen.getByLabelText("โลโก้กลาง QR"), "mark.png");
    expect(previewSvg()).toContain(`href="${PNG_URL}"`);

    // A second file replaces the first through "choose a new image".
    await upload("other.png", "เลือกรูปใหม่…");
    await waitFor(() =>
      expect(screen.getByLabelText("โลโก้กลาง QR").textContent).toContain("other.png"),
    );
  });

  test("a long file name is shortened, with the full name on hover", async () => {
    setup();
    type("https://example.com");
    const name = "IT3K-official-logo-final-final-v3-approved.png";
    await upload(name);
    const trigger = screen.getByLabelText("โลโก้กลาง QR");
    await waitFor(() => expect(trigger.textContent).toContain("IT3K-official-l…oved.png"));
    expect(trigger.querySelector(`[title="${name}"]`)).not.toBeNull();
  });
});

describe("QrStudio remembers its settings", () => {
  const trigger = (label: string) => screen.getByLabelText(label).textContent ?? "";
  const colorValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

  test("brings back the design, logo and export size on the next visit", async () => {
    setup();
    type("https://secret.example/private");
    await choose(screen.getByLabelText("รูปแบบจุด"), "วงกลม");
    fireEvent.change(screen.getByLabelText("สีจุด"), { target: { value: "#003366" } });
    fireEvent.click(button("ตั้งค่าขั้นสูง (ไม่บังคับ)"));
    await choose(screen.getByLabelText("ขนาดไฟล์ PNG/JPG"), "2048 × 2048 px");
    await upload("mark.png");
    await waitFor(() => expect(trigger("โลโก้กลาง QR")).toContain("mark.png"));

    cleanup();
    setup();
    expect(trigger("รูปแบบจุด")).toContain("วงกลม");
    expect(colorValue("สีจุด")).toBe("#003366");
    expect(trigger("ขนาดไฟล์ PNG/JPG")).toContain("2048");
    expect(trigger("โลโก้กลาง QR")).toContain("mark.png");
    // The text itself is never saved.
    expect((screen.getByLabelText("URL หรือข้อความ") as HTMLTextAreaElement).value).toBe("");
    expect(window.localStorage.getItem("it3k:qr-studio")).not.toContain("secret.example");

    type("hello");
    expect(previewSvg()).toContain(`href="${PNG_URL}"`);
  });

  test("starts from the defaults when the saved settings are unreadable", () => {
    window.localStorage.setItem("it3k:qr-studio", "{not json");
    setup();
    expect(trigger("รูปแบบจุด")).toContain("สี่เหลี่ยม");
    expect(button("ค่าเริ่มต้น").disabled).toBe(true);
  });

  test("keeps the good fields when only some saved ones are bad", () => {
    window.localStorage.setItem(
      "it3k:qr-studio",
      JSON.stringify({ design: { dotStyle: "star", dotColor: "#003366" }, exportSize: 999 }),
    );
    setup();
    expect(trigger("รูปแบบจุด")).toContain("สี่เหลี่ยม");
    expect(colorValue("สีจุด")).toBe("#003366");
    expect(trigger("ขนาดไฟล์ PNG/JPG")).toContain("1024");
  });

  test("the reset button goes back to the defaults and forgets the logo", async () => {
    setup();
    type("hello");
    expect(button("ค่าเริ่มต้น").disabled).toBe(true);
    await choose(screen.getByLabelText("รูปแบบจุด"), "วงกลม");
    await upload("mark.png");
    await waitFor(() => expect(previewSvg()).toContain("<image"));

    fireEvent.click(button("ค่าเริ่มต้น"));
    expect(trigger("รูปแบบจุด")).toContain("สี่เหลี่ยม");
    expect(previewSvg()).not.toContain("<image");
    expect(trigger("โลโก้กลาง QR")).toContain("ไม่มีโลโก้");
    expect(button("ค่าเริ่มต้น").disabled).toBe(true);

    cleanup();
    setup();
    expect(trigger("รูปแบบจุด")).toContain("สี่เหลี่ยม");
  });
});

describe("QrStudio on a phone", () => {
  const original = window.matchMedia;
  beforeEach(() => {
    // Every width query matches, as on a narrow screen.
    window.matchMedia = ((media: string) => ({
      matches: true,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  const bar = () => screen.getByRole("region", { name: "แถบคำสั่ง" });

  test("keeps export in a bar and the preview in a drawer", async () => {
    const { downloads } = setup();
    type("hello");
    // No preview panel on the page itself; the bar shows a thumbnail instead.
    expect(screen.queryByRole("region", { name: "ตัวอย่าง QR" })).toBeNull();
    expect(within(bar()).getByRole("button", { name: "ดูตัวอย่าง" })).toBeTruthy();

    fireEvent.click(within(bar()).getByRole("button", { name: "ดาวน์โหลด PNG" }));
    await waitFor(() => expect(downloads.map((d) => d.name)).toEqual(["it3k-qr-hello.png"]));

    fireEvent.click(within(bar()).getByRole("button", { name: "ดูตัวอย่าง" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("img", { name: "QR code ของ hello" })).toBeTruthy();
    expect(within(drawer).getByText("พร้อมใช้งาน สแกนทดสอบก่อนพิมพ์ทุกครั้ง")).toBeTruthy();
  });

  test("says in the bar what stops the QR scanning", () => {
    setup();
    type("https://example.com");
    fireEvent.change(screen.getByLabelText("สีจุด"), { target: { value: "#dddddd" } });
    expect(within(bar()).getByText(/ใกล้กันเกินไป/)).toBeTruthy();
    expect(
      (within(bar()).getByRole("button", { name: "ดาวน์โหลด PNG" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("text too long for a QR code shows in the bar too", () => {
    setup();
    type("ก".repeat(3000));
    expect(within(bar()).getByText(/ยาวเกินกว่าที่ QR จะเก็บได้/)).toBeTruthy();
  });
});
