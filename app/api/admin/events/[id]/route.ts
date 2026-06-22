import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";
import { eventUpdateSchema } from "@/lib/validation";

// Stubs until P2.5 (DB wiring + ownership via guard.ctx). Guard migrated to the
// real session context in P2 (audit H2).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  // TODO(P2.5): load event `id`, enforce ownership via guard.ctx.
  return NextResponse.json({ data: null });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  const body: unknown = await req.json();
  const result = eventUpdateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  // TODO(P2.5): persist the update for event `id`, enforce ownership via guard.ctx.
  return NextResponse.json({ data: null });
}
