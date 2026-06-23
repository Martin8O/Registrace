import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { centerUpdateSchema } from "@/lib/validation";
import { updateCenter, setCenterActive } from "@/modules/centers";

// PUT — rename a centre (name_cs/_en). SUPER_ADMIN only. 400 invalid.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = centerUpdateSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  await updateCenter(id, result.data, guard.ctx);
  return NextResponse.json({ data: { id } });
}

// DELETE — "delete" a centre = deactivate (isActive=false). Soft by design: a
// hard delete would hit the RESTRICT FKs and breaks invariant 9. SUPER_ADMIN only.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;
  await setCenterActive(id, false, guard.ctx);
  return NextResponse.json({ data: { id } });
}

// PATCH — restore a deactivated centre (isActive=true). SUPER_ADMIN only.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;
  await setCenterActive(id, true, guard.ctx);
  return NextResponse.json({ data: { id } });
}
