import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import jsQR from "jsqr";

import { sampleContext, sampleTicketClaimed } from "./fixtures";
import { TICKET_QR_CID, qrPng, ticketQrText } from "./qr-png";
import { renderEmail } from "./render";

/** Reads back a 1-bit grayscale PNG as RGBA pixels, checking every chunk's CRC. */
function decodePng(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    const crc = view.getUint32(at + 8 + length);
    expect(crc).toBe(Bun.hash.crc32(png.subarray(at + 4, at + 8 + length)));
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      expect([...data.subarray(8)]).toEqual([1, 0, 0, 0, 0]);
    }
    if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width / 8);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (rowBytes + 1)]).toBe(0);
    for (let x = 0; x < width; x++) {
      const bit = ((raw[y * (rowBytes + 1) + 1 + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
      rgba.fill(bit ? 255 : 0, (y * width + x) * 4, (y * width + x) * 4 + 3);
      rgba[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, rgba };
}

describe("ticket QR", () => {
  test("the PNG is valid and scans back to the ticket text", () => {
    const text = ticketQrText("Zx3sQm9vT2kLp8RwYb4NcHd7Ue1Fa6Jg");
    const { width, height, rgba } = decodePng(qrPng(text));
    expect(width).toBe(height);
    expect(width % 8).toBe(0);
    expect(jsQR(rgba, width, height)?.data).toBe(text);
  });

  test("the ticket email carries the QR as an inline PNG", async () => {
    const out = await renderEmail(sampleTicketClaimed, sampleContext);
    expect(out.html).toContain(`src="cid:${TICKET_QR_CID}"`);
    expect(out.html).not.toContain("data:image");
    expect(out.attachments).toHaveLength(1);
    const [qr] = out.attachments ?? [];
    expect(qr).toMatchObject({
      type: "image/png",
      disposition: "inline",
      contentId: TICKET_QR_CID,
    });
    const { width, height, rgba } = decodePng(Buffer.from(qr?.content ?? "", "base64"));
    expect(jsQR(rgba, width, height)?.data).toBe(
      ticketQrText(sampleTicketClaimed.ticket.code ?? ""),
    );
  });

  test("a job queued before codes were sent renders without a QR", async () => {
    const { code: _code, ...ticket } = sampleTicketClaimed.ticket;
    const out = await renderEmail({ ...sampleTicketClaimed, ticket }, sampleContext);
    expect(out.attachments).toBeUndefined();
    expect(out.html).not.toContain("cid:");
    expect(out.html).toContain("เปิดหน้าตั๋วแล้วแสดง QR code");
  });
});
