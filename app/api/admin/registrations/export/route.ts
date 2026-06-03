import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/guard";

// POST per architecture rule: export endpoint accepts filters in body, not query params
export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  return NextResponse.json({ data: [] });
}
