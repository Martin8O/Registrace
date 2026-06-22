import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { userUpdateSchema } from "@/lib/validation";
import { updateUser, removeUser, UserManagementError } from "@/modules/users";

// PUT — change a user's role + centre assignment. SUPER_ADMIN only.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = userUpdateSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  try {
    await updateUser(id, result.data, guard.ctx);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    if (err instanceof UserManagementError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}

// DELETE — remove an admin entirely (auth identity + Prisma row). SUPER_ADMIN
// only; the service blocks self-removal.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  try {
    await removeUser(id, guard.ctx);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    if (err instanceof UserManagementError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
