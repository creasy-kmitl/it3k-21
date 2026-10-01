// Turns a spreadsheet of links into rows the bulk API takes, checking each row
// with the same rules the API applies so problems show before anything is sent.
import {
  DESTINATION_MAX,
  SLUG_MAX,
  SLUG_MIN,
  SLUG_PATTERN,
  TAG_MAX_COUNT,
  TITLE_MAX,
  destinationProblem,
  normalizeTag,
} from "@it3k/db/short-link-rules";

import { parseCsv } from "./csv";
import { type BulkLinkInput, LINK_ERROR_MESSAGES } from "./links";

/** Most rows one import may hold; the API takes the same. */
export const IMPORT_MAX = 100;

type Column = "title" | "destination" | "slug" | "tags" | "fallbackUrl";

/** Header names each column answers to, English or Thai, in any case. */
const HEADERS: Record<Column, string[]> = {
  title: ["title", "name", "ชื่อ", "ชื่อลิงก์"],
  destination: ["destination", "url", "ปลายทาง"],
  slug: ["slug", "ชื่อท้ายลิงก์"],
  tags: ["tags", "tag", "แท็ก"],
  fallbackUrl: ["fallback_url", "fallback", "ปลายทางสำรอง"],
};

export const TEMPLATE_ROWS = [
  ["title", "destination", "slug", "tags", "fallback_url"],
  ["บูธ ROV", "https://forms.example.com/rov", "booth-rov", "booth|rov", ""],
  ["บูธ Valorant", "https://forms.example.com/valorant", "", "booth", "https://it3k.creasy.club"],
];

export type ImportRow = {
  /** The spreadsheet's line number, header included, for people to find it. */
  line: number;
  input: BulkLinkInput;
  errors: string[];
};

export type ImportResult = { ok: true; rows: ImportRow[] } | { ok: false; message: string };

export function parseLinkImport(text: string, shortLinkHost: string): ImportResult {
  // Cells pasted from a spreadsheet are tab-separated; files are comma-separated.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const [header, ...body] = parseCsv(text, firstLine.includes("\t") ? "\t" : ",");
  if (!header) return { ok: false, message: "ไฟล์ว่าง ใส่หัวตารางและลิงก์อย่างน้อยหนึ่งแถว" };
  const names = header.map((name) => name.trim().toLowerCase());
  const index = Object.fromEntries(
    (Object.keys(HEADERS) as Column[]).map((column) => [
      column,
      names.findIndex((name) => HEADERS[column].includes(name)),
    ]),
  ) as Record<Column, number>;
  if (index.title < 0 || index.destination < 0) {
    return { ok: false, message: "หัวตารางต้องมีคอลัมน์ title และ destination (ดูไฟล์ตัวอย่าง)" };
  }
  if (body.length === 0) return { ok: false, message: "ยังไม่มีลิงก์ใต้หัวตาราง" };
  if (body.length > IMPORT_MAX) {
    return { ok: false, message: `สร้างได้ครั้งละไม่เกิน ${IMPORT_MAX} ลิงก์ (ไฟล์นี้มี ${body.length})` };
  }

  const seen = new Set<string>();
  const rows = body.map((cells, i): ImportRow => {
    const cell = (column: Column) =>
      index[column] >= 0 ? (cells[index[column]] ?? "").trim() : "";
    const errors: string[] = [];
    const title = cell("title");
    const destination = cell("destination");
    const slug = cell("slug").toLowerCase();
    const fallbackUrl = cell("fallbackUrl");
    const tags = [...new Set(cell("tags").split(/[|;]/).map(normalizeTag).filter(Boolean))];

    if (!title) errors.push("ไม่มีชื่อลิงก์");
    else if (title.length > TITLE_MAX) errors.push(`ชื่อยาวเกิน ${TITLE_MAX} ตัวอักษร`);
    const problem = destination ? destinationProblem(destination, shortLinkHost) : null;
    if (!destination) errors.push("ไม่มีปลายทาง");
    else if (destination.length > DESTINATION_MAX) errors.push("ปลายทางยาวเกินไป");
    else if (problem) errors.push(LINK_ERROR_MESSAGES[problem]);
    if (slug) {
      if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug)) {
        errors.push("ชื่อท้ายลิงก์ใช้ได้แค่ a–z, 0–9 และขีดกลาง ยาว 3–64 ตัว");
      } else if (seen.has(slug)) {
        errors.push(LINK_ERROR_MESSAGES["slug-duplicate"]);
      }
      seen.add(slug);
    }
    if (tags.length > TAG_MAX_COUNT) errors.push(`แท็กได้ไม่เกิน ${TAG_MAX_COUNT} อัน`);
    const fallbackProblem = fallbackUrl ? destinationProblem(fallbackUrl, shortLinkHost) : null;
    if (fallbackProblem) errors.push(`ปลายทางสำรอง: ${LINK_ERROR_MESSAGES[fallbackProblem]}`);

    return {
      line: i + 2,
      input: {
        title,
        destination,
        ...(slug ? { slug } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(fallbackUrl ? { fallbackUrl } : {}),
      },
      errors,
    };
  });
  return { ok: true, rows };
}
