import { NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";

// GET — admin registrations list. Stub until P2.5 (DB wiring + role/ownership
// scoping via guard.ctx). P2 (audit H2) migrated the guard from the legacy
// header-presence check to the real Supabase session context.
export async function GET() {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  // TODO(P2.5): list registrations from the DB, scoped by guard.ctx (role/ownership).
  return NextResponse.json({ data: [] });
}
