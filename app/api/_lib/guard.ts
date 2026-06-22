import { NextResponse } from "next/server";
import { getAdminContext, type AdminContext } from "@/modules/auth";

// The single admin guard: verifies the Supabase session, upserts the User row,
// and loads role + assigned centres. Used by every admin endpoint.
//
// P2 (audit H2) removed the legacy header-presence `requireAdmin` — it only
// checked that an `Authorization` header existed, which was meaningless as
// authorization and incompatible with the real cookie-based admin login. Every
// admin route now resolves a real session context here.
//
// TODO(P4): consolidate with the proxy.ts session-presence guard so the edge and
// the handler share one role/ownership check (defence in depth).
export type AdminGuard = { ctx: AdminContext } | { response: NextResponse };

export async function requireAdminContext(): Promise<AdminGuard> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ctx };
}

// SUPER_ADMIN-only guard (P2.5): same session resolution as requireAdminContext,
// but a non-super admin gets 403. Used by the user- and centre-management
// endpoints, which SUPER_ADMIN owns exclusively (invariant 20). The 401 (no
// session) vs 403 (session, wrong role) split mirrors the centre-POST gate.
export async function requireSuperAdmin(): Promise<AdminGuard> {
  const guard = await requireAdminContext();
  if ("response" in guard) return guard;
  if (guard.ctx.role !== "SUPER_ADMIN") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return guard;
}
