import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/app/api/_lib/guard";
import { resetUserPassword, UserManagementError } from "@/modules/users";

// POST — send the user a password-reset email via Supabase Auth. SUPER_ADMIN
// only. The honest send result is returned (Supabase's own email; subject to its
// dev rate limits, not the Resend test-mode limit).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSuperAdmin(req);
  if ("response" in guard) return guard.response;

  const { id } = await params;
  try {
    const result = await resetUserPassword(id, guard.ctx);
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof UserManagementError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
