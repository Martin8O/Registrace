import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { registrationExportSchema } from "@/lib/validation";
import { buildRegistrationExportWorkbook } from "@/modules/registrations";
import { logAuditEvent } from "@/lib/audit";
import { toXlsx } from "@/lib/export/xlsx";

// POST per invariant 17 (export filters in the body, not query params). Admin +
// CSRF guarded (requireAdminContext(req)); role/ownership scoping happens inside
// the service. XLSX-only (exceljs), always scoped to one event; labels localized
// to the requested `lang`. Thin handler (invariant 8) — only serialization here.
export async function POST(req: NextRequest) {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard.response;

  const body: unknown = await req.json().catch(() => null);
  const parsed = registrationExportSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { format, lang, ...filters } = parsed.data;

  // The full workbook: full data, the trimmed selection, plus the kitchen
  // meal-prep and accommodation tables — one sheet each, the event name as title.
  const { sheets } = await buildRegistrationExportWorkbook(filters, guard.ctx, lang);

  // Exporting registrant PII is audit-worthy (who pulled what, when) — best-effort.
  await logAuditEvent({
    userId: guard.ctx.userId,
    ip: guard.ctx.ip,
    action: "registration.export",
    entityType: "Registration",
    entityId: "export",
    newData: { format, lang, count: sheets[0]?.rows.length ?? 0, filters },
  });

  // Filename date = today in Europe/Prague (en-CA → YYYY-MM-DD).
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(
    new Date(),
  );
  const xlsx = await toXlsx(sheets);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="registrations-${stamp}.xlsx"`,
    },
  });
}
