// CSV serialization for admin exports (P7). RFC-4180-style: a field containing
// a comma, double-quote, or newline is wrapped in double-quotes with internal
// quotes doubled; rows are CRLF-terminated (Excel-friendly). The caller prepends
// a UTF-8 BOM so Excel reads Czech diacritics correctly. Comma delimiter (the
// portable default for any tooling); Excel users who want zero import friction
// use the .xlsx export instead.

export type ExportTable = {
  headers: string[];
  rows: (string | number)[][];
  sheetName: string;
};

function escapeField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: Pick<ExportTable, "headers" | "rows">): string {
  return [table.headers, ...table.rows]
    .map((row) => row.map(escapeField).join(","))
    .join("\r\n");
}
