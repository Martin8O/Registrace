import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";

// Stubs until P2.5 (DB wiring + ownership via guard.ctx). Guard migrated to the
// real session context in P2 (audit H2).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  // TODO(P2.5): load registration `id` from the DB, enforce ownership via guard.ctx.
  return NextResponse.json({ data: null });
}

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  const { id } = await params;
  // TODO(P2.5): update registration `id` (e.g. status), enforce ownership via guard.ctx.
  return NextResponse.json({ data: null });
}
