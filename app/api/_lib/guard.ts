import { NextResponse, type NextRequest } from "next/server";
import { getAdminContext, type AdminContext } from "@/modules/auth";
import { isMutating, isSameOrigin, csrfFailureResponse } from "@/lib/security/csrf";

// The single admin guard: verifies the Supabase session and loads the EXISTING
// User row's role + assigned centres (no row → 401; rows are minted only by
// inviteUser, never on login — see the C1 fix in modules/auth). Used by every
// admin endpoint.
//
// P2 (audit H2) removed the legacy header-presence `requireAdmin` — it only
// checked that an `Authorization` header existed, which was meaningless as
// authorization and incompatible with the real cookie-based admin login. Every
// admin route now resolves a real session context here.
//
// DECISION C (P4): this is the AUTHORITATIVE role/ownership layer. proxy.ts does
// session presence + abuse controls at the edge, but the real role check (ADMIN
// vs SUPER_ADMIN) and Event.createdBy ownership live here / in the services,
// because Prisma can't run in the edge runtime. Two deliberate layers (defence in
// depth) — not consolidated into one.
export type AdminGuard = { ctx: AdminContext } | { response: NextResponse };

// Pass `req` from MUTATING handlers (POST/PUT/PATCH/DELETE) to get a
// defence-in-depth CSRF check here (P4): proxy.ts is the primary edge origin
// gate, but re-asserting at the handler means a middleware/matcher regression
// can't silently disable CSRF. Pure header logic — no extra round-trip. GET
// handlers omit `req` (CSRF doesn't apply to safe methods).
export async function requireAdminContext(req?: NextRequest): Promise<AdminGuard> {
  if (req && isMutating(req.method) && !isSameOrigin(req)) {
    return { response: csrfFailureResponse() };
  }
  const ctx = await getAdminContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ctx };
}

// SUPER_ADMIN-only guard (P2.5): same session resolution + CSRF as
// requireAdminContext, but a non-super admin gets 403. Used by the user- and
// centre-management endpoints, which SUPER_ADMIN owns exclusively (invariant 20).
// The 401 (no session) vs 403 (session, wrong role) split mirrors the centre-POST gate.
export async function requireSuperAdmin(req?: NextRequest): Promise<AdminGuard> {
  const guard = await requireAdminContext(req);
  if ("response" in guard) return guard;
  if (guard.ctx.role !== "SUPER_ADMIN") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return guard;
}
