import { NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { listRegistrations } from "@/modules/registrations";

// GET — admin registrations list, role/ownership-scoped (ADMIN: registrations on
// their own events; SUPER_ADMIN: all). Thin handler (invariant 8).
export async function GET() {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const registrations = await listRegistrations(guard.ctx);
  return NextResponse.json({ data: registrations });
}
