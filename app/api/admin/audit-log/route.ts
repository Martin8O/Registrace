import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/app/api/_lib/guard";
import { listAuditLogs } from "@/lib/audit";

// GET — admin audit log (P4). SUPER_ADMIN only: AuditLog has no FK to
// Event/Registration, so there's no clean way to scope an ADMIN to "their" rows;
// the audit view is restricted to the super-admin (like user/centre management).
// Returns the 200 most recent entries (shared read in lib/audit, also used by the
// Logs page). AuditLog rows are append-only — this endpoint never mutates them.
export async function GET() {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const data = await listAuditLogs();
  return NextResponse.json({ data });
}
