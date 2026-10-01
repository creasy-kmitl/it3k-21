// Spreadsheet exports as .xlsx, written in the browser. Every piece of text is
// a text cell (inlineStr): in .xlsx a formula exists only inside an <f>
// element, so a title like "=HYPERLINK(…)" stays text when the file is
// opened, saved and opened again. A CSV cannot promise that; see OWASP's
// "CSV Injection".
import { strToU8, zipSync } from "fflate";

export type XlsxCell = string | number | null | undefined;

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Characters XML 1.0 can hold: tab, line breaks, and everything from space up but two. */
function xmlAllowed(char: string) {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20) return code === 0x9 || code === 0xa || code === 0xd;
  return code !== 0xfffe && code !== 0xffff;
}

/** XML text: escaped, minus the control characters XML 1.0 cannot hold. */
function xmlText(value: string) {
  return Array.from(value)
    .filter(xmlAllowed)
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A, B, …, Z, AA, AB, … */
function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function cellXml(value: XlsxCell, ref: string, header: boolean) {
  const style = header ? ' s="1"' : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  const text = value === null || value === undefined ? "" : String(value);
  if (text === "") return "";
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

/** Sheet names: at most 31 characters, none of []:*?/\ */
const sheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1";

/**
 * One sheet, its first row bold and frozen as the header, columns sized to
 * their content. Numbers stay numbers; everything else is text.
 */
export function toXlsx(name: string, rows: XlsxCell[][]) {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((value, i) => {
      const length = [...String(value ?? "")].length;
      widths[i] = Math.min(60, Math.max(widths[i] ?? 8, length + 2));
    });
  }
  const cols = widths
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const sheetData = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.map((value, c) => cellXml(value, `${columnName(c)}${r + 1}`, r === 0)).join("")}</row>`,
    )
    .join("");

  const files: Record<string, string> = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${DOC_RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${MAIN}" xmlns:r="${DOC_RELS}"><sheets><sheet name="${xmlText(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${DOC_RELS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${DOC_RELS}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `${XML}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${sheetData}</sheetData></worksheet>`,
  };
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])),
  );
}

export const xlsxBlob = (name: string, rows: XlsxCell[][]) =>
  new Blob([toXlsx(name, rows)], { type: XLSX_TYPE });
