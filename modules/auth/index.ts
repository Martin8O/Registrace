// modules/auth — server-only admin session/role resolution (invariant 1: auth =
// Supabase Auth, data = Prisma; never mix). Bridges a Supabase Auth user to a
// Prisma `User` row and loads the role + assigned centre ids.

import { prisma } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

export type AdminRole = "ADMIN" | "SUPER_ADMIN";

export type AdminContext = {
  userId: string; // = Supabase Auth user id (UUID), matches User.id (invariant 12)
  role: AdminRole;
  centerIds: string[]; // centres this user administers (via UserCenter)
};

// Verify the current Supabase session and resolve the admin context. Returns
// null when there is no authenticated user (caller maps to 401).
//
// On first sight of a Supabase user we upsert a Prisma `User` row (default role
// ADMIN) — this bridges a freshly-created auth user to a User record until the
// User-invite flow ships. Role is never downgraded here: the update touches only
// the email, so a promoted SUPER_ADMIN stays SUPER_ADMIN.
//
// TODO(P4): the same session→role→centre check belongs in proxy.ts (middleware)
// for defence in depth; B7 enforces it at the handler/service layer only.
export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const dbUser = await prisma.user.upsert({
    where: { id: user.id },
    update: { email: user.email ?? undefined },
    create: { id: user.id, email: user.email ?? `${user.id}@placeholder.local`, role: "ADMIN" },
    include: { centers: true },
  });

  return {
    userId: dbUser.id,
    role: dbUser.role,
    centerIds: dbUser.centers.map((c) => c.centerId),
  };
}
