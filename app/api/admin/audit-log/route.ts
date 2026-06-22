import { NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";

// GET — admin audit log. Stub until P4 (AuditLog writes + reads). Guard migrated
// to the real session context in P2 (audit H2).
export async function GET() {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  return NextResponse.json({ data: [] });
}
