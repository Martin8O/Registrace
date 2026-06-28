// Client helper: POST the export filters and stream the XLSX back as a browser
// download. Shared by the per-event registrations view and the events-list row
// action — both export a single event in the admin's UI language (XLSX-only).

export type ExportFilters = {
  eventId?: string;
  centerId?: string;
  status?: string;
  search?: string;
};

function filenameFromHeader(header: string | null): string {
  const match = header?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? "registrations.xlsx";
}

export async function downloadRegistrationsExport(
  filters: ExportFilters,
  lang: "cs" | "en",
): Promise<boolean> {
  const res = await fetch("/api/admin/registrations/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...filters, format: "excel", lang }),
  });
  if (!res.ok) return false;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFromHeader(res.headers.get("content-disposition"));
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
