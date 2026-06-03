import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/guard";

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  return NextResponse.json({ data: [] });
}
