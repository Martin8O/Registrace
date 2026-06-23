import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext, requireSuperAdmin } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { centerCreateSchema } from "@/lib/validation";
import { getCentersForSelect } from "@/modules/events";
import { createCenter } from "@/modules/centers";

// GET — active centres for selects. Any authenticated admin (the event-create
// form needs the full centre list).
export async function GET() {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const centers = await getCentersForSelect();
  return NextResponse.json({ data: centers });
}

// POST — add a centre. SUPER_ADMIN only (P1 audit C2). Logic in modules/centers
// (invariant 8); the new centre is active and appears in every picker at once.
export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if ("response" in guard) return guard.response;

  const body: unknown = await req.json();
  const result = centerCreateSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  const { id } = await createCenter(result.data, guard.ctx);
  return NextResponse.json({ data: { id } }, { status: 201 });
}
