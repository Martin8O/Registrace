import { NextRequest, NextResponse } from "next/server";

// TODO: replace with real Supabase session check via modules/auth
export function requireAdmin(req: NextRequest): NextResponse | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
