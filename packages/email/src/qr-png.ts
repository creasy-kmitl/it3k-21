import { TICKET_QR_PREFIX } from "@it3k/db/event-rules";
import { encode } from "uqr";

/** What a ticket's QR encodes; the kiosk reads the same text from the web ticket. */
export const ticketQrText = (code: string) => `${TICKET_QR_PREFIX}${code}`;

/** The Content-ID the ticket email's `<img src="cid:…">` points at. */
export const TICKET_QR_CID = "ticket-qr";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];

/**
 * A zlib stream of stored (uncompressed) deflate blocks. A 1-bit QR is a few
 * kilobytes raw, so skipping compression keeps this synchronous and tiny.
 */
function zlibStored(data: Uint8Array) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out.set([0x78, 0x01]);
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const chunk = data.subarray(i * 65535, (i + 1) * 65535);
    const len = chunk.length;
    out.set([i === blocks - 1 ? 1 : 0, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255], at);
    out.set(chunk, at + 5);
    at += 5 + len;
  }
  out.set(u32(adler32(data)), at);
  return out;
}

function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array(4 + data.length);
  body.set([...type].map((ch) => ch.charCodeAt(0)));
  body.set(data, 4);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/**
 * Draws `text` as a black-on-white QR PNG: 1-bit grayscale, `scale` pixels per
 * module, with the quiet zone scanners need. Plain square modules, like the
 * ticket on the web, since it is held up to a kiosk camera.
 */
export function qrPng(text: string, { scale = 8, quietZone = 4 } = {}) {
  const { size, data: modules } = encode(text, { ecc: "M", border: 0 });
  const width = (size + quietZone * 2) * scale;
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * width);
  for (let y = 0; y < width; y++) {
    const row = y * (rowBytes + 1);
    // Filter byte 0 (none), then 1 bit per pixel: 1 is white, 0 is black.
    const my = Math.floor(y / scale) - quietZone;
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / scale) - quietZone;
      const dark = modules[my]?.[mx] === true;
      const at = row + 1 + (x >> 3);
      if (!dark) raw[at] = (raw[at] ?? 0) | (0x80 >> (x & 7));
    }
  }
  const header = new Uint8Array([...u32(width), ...u32(width), 1, 0, 0, 0, 0]);
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", header),
    ...chunk("IDAT", zlibStored(raw)),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
