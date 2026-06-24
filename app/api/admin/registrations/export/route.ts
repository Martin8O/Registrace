import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { registrationExportSchema } from "@/lib/validation";
import { buildRegistrationExport } from "@/modules/registrations";
import { logAuditEvent } from "@/lib/audit";
import { toCsv } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";

// UTF-8 BOM — prepended to CSV so Excel detects UTF-8 and renders Czech
// diacritics correctly. Built via fromCharCode to keep the source free of an
// invisible literal character.
const UTF8_BOM = String.fromCharCode(0xfeff);

// POST per invariant 17 (export filters in the body, not query params). Admin +
// CSRF guarded (requireAdminContext(req)); role/ownership scoping happens inside
// buildRegistrationExport. CSV (UTF-8 BOM) or XLSX (exceljs); labels localized
// to the requested `lang`. Thin handler (invariant 8) — only serialization here.
export async function POST(req: NextRequest) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const body: unknown = await req.json().catch(() => null);
  const parsed = registrationExportSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { format, lang, ...filters } = parsed.data;
  const table = await buildRegistrationExport(filters, guard.ctx, lang);

  // Exporting registrant PII is audit-worthy (who pulled what, when) — best-effort.
  await logAuditEvent({
    userId: guard.ctx.userId,
    ip: guard.ctx.ip,
    action: "registration.export",
    entityType: "Registration",
    entityId: "export",
    newData: { format, lang, count: table.rows.length, filters },
  });

  // Filename date = today in Europe/Prague (en-CA → YYYY-MM-DD).
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(
    new Date(),
  );
  const base = `registrations-${stamp}`;

  if (format === "csv") {
    const csv = UTF8_BOM + toCsv(table);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  const xlsx = await toXlsx(table);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
