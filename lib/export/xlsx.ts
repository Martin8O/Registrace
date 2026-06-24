// XLSX serialization for admin exports (P7) via exceljs. We chose exceljs over
// the `xlsx`/SheetJS package because SheetJS stopped publishing to npm — its
// newest npm build (0.18.5) carries a HIGH-severity advisory (prototype
// pollution / ReDoS), which P8's `npm audit` gate would flag. exceljs is
// maintained and audit-clean. The advisory class is parser-side anyway and we
// only ever WRITE workbooks (never parse untrusted uploads).
//
// Output: a single sheet, bold + frozen header row, roughly auto-sized columns.

import ExcelJS from "exceljs";
import type { ExportTable } from "@/lib/export/csv";

export async function toXlsx(table: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(table.sheetName);

  ws.addRow(table.headers);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of table.rows) ws.addRow(row);

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

  return Buffer.from(await wb.xlsx.writeBuffer());
}
