import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getAdminContext } from "@/modules/auth";
import { prisma } from "@/lib/db";

// GET — the current admin's identity { id, email, role } or null when not
// signed in. Resolves the real Supabase session via getAdminContext (which reads
// the existing User row; no row → null), then reads the email from the Prisma
// row. Replaces the former auth stub.
export async function GET(req: Request) {
  // Rate limit (P8): this route does a Supabase session lookup + Prisma read on
  // every call and isn't on the /api/admin edge matcher, so bound it per-IP at a
  // human-level 60/min (the admin nav polls it on page loads, not in a tight loop).
  const limited = enforceRateLimit(req, { bucket: "auth-me", limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { id: true, email: true, role: true },
  });
  return NextResponse.json({ user });
}
