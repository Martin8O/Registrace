import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { getRegistrationForDetail } from "@/modules/registrations";

// GET — one registration (full detail), ownership-scoped. Missing/not-owned → 404.
// Editing is PUT …/[id]/full and its live price POST …/[id]/calculate-price (M50).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const registration = await getRegistrationForDetail(id, guard.ctx);
  if (!registration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: registration });
}
