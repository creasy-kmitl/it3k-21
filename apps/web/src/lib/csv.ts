// CSV in and out for spreadsheets. Excel opens a UTF-8 file as Thai only when
// it starts with a byte-order mark, so every file written here has one.

const BOM = "﻿";

/**
 * Rows of cells from CSV text: quoted cells, doubled quotes, CRLF or LF.
 * `delimiter` is a tab for what Google Sheets and Excel put on the clipboard.
 */
export function parseCsv(text: string, delimiter: "," | "\t" = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines carry nothing.
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

const quote = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * Text a spreadsheet would run as a formula (=, +, -, @, or a leading tab or
 * CR) is written with an apostrophe in front, which spreadsheets show as
 * plain text. Quoting alone does not stop it. Numbers are left as they are.
 * See OWASP's "CSV Injection".
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const defuse = (value: string) => (FORMULA_START.test(value) ? `'${value}` : value);

/** Undoes the apostrophe toCsv adds, so a file this app wrote reads back as typed. */
export const undefuse = (value: string) =>
  value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;

/**
 * CSV text, with a byte-order mark so Excel reads Thai correctly, and with
 * text that looks like a formula defused.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) =>
    typeof value === "number" ? String(value) : quote(defuse(value ?? ""));
  return `${BOM}${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export const csvBlob = (rows: Parameters<typeof toCsv>[0]) =>
  new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
