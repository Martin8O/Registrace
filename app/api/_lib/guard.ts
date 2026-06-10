import { NextRequest, NextResponse } from "next/server";
import { getAdminContext, type AdminContext } from "@/modules/auth";

// Real admin guard (B7c): verifies the Supabase session, upserts the User row,
// and loads role + assigned centres. Used by the live admin endpoints. Returns
// either the resolved context or a 401 response to return immediately.
//
// TODO(P4): consolidate this with the proxy.ts session-presence guard so the
// edge and the handler share one role/ownership check.
export type AdminGuard = { ctx: AdminContext } | { response: NextResponse };

export async function requireAdminContext(): Promise<AdminGuard> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ctx };
}

// Legacy header-presence guard — retained ONLY for the deferred stub admin routes
// (registrations/*, audit-log, event PUT/PATCH) that are not wired in B7c. Those
// routes are already session-guarded at the edge by proxy.ts (/api/admin/** → 401
// when unauthenticated). They migrate to requireAdminContext when wired (P-phase).
export function requireAdmin(req: NextRequest): NextResponse | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
