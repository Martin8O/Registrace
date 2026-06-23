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
// SUPER_ADMIN only. 400 invalid payload; UserManagementError carries its own
// status (P4 taxonomy): 409 email already taken, 403 wrong role, 422 other.
export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
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
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
