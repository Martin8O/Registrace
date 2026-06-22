import { NextResponse } from "next/server";
import { getAdminContext } from "@/modules/auth";
import { prisma } from "@/lib/db";

// GET — the current admin's identity { id, email, role } or null when not
// signed in. Resolves the real Supabase session via getAdminContext (which also
// upserts the User row), then reads the email from the Prisma row. Replaces the
// former auth stub.
export async function GET() {
  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { id: true, email: true, role: true },
  });
  return NextResponse.json({ user });
}
