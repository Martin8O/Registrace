import { NextRequest, NextResponse } from "next/server";
import { requireAdminContext } from "@/app/api/_lib/guard";

// POST per architecture rule (export filters in body, not query params).
// Stub until P7 (export). Guard migrated to the real session context in P2 (H2).
export async function POST(_req: NextRequest) {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard.response;

  // TODO(P7): parse filters from body; export rows scoped by guard.ctx.
  return NextResponse.json({ data: [] });
}
