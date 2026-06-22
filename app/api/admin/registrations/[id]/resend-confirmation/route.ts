import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";

// Stub until P6 (email templates + manual resend). Guard migrated to the real
// session context in P2 (audit H2).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  // TODO(P6): resend confirmation for registration `id`, enforce ownership via guard.ctx.
  return NextResponse.json({ success: true });
}
