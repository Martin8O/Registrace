import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/app/api/_lib/guard";
import { validationError } from "@/app/api/_lib/http";
import { userInviteSchema } from "@/lib/validation";
import { listUsers, inviteUser, UserManagementError } from "@/modules/users";

// GET — all admin users + role + centre assignment. SUPER_ADMIN only.
export async function GET() {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const users = await listUsers(guard.ctx);
  return NextResponse.json({ data: users });
}

// POST — invite a new admin (Supabase auth user + invite email + Prisma row).
// SUPER_ADMIN only. 400 invalid payload; 422 Supabase rejection (admin-ops
// error taxonomy is P4's to refine — see UserManagementError).
export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if ("response" in guard) return guard.response;

  const body: unknown = await req.json();
  const result = userInviteSchema.safeParse(body);
  if (!result.success) {
    return validationError(result.error);
  }

  try {
    const { id } = await inviteUser(result.data, guard.ctx);
    return NextResponse.json({ data: { id } }, { status: 201 });
  } catch (err) {
    if (err instanceof UserManagementError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
