import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { eventStatusSchema } from "@/lib/validation";

// Stub until P2.5 (DB wiring + ownership via guard.ctx). Guard migrated to the
// real session context in P2 (audit H2).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = eventStatusSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  // TODO(P2.5): persist the status change for event `id`, enforce ownership via guard.ctx.
  return NextResponse.json({ data: null });
}
