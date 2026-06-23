// modules/auth — server-only admin session/role resolution (invariant 1: auth =
// Supabase Auth, data = Prisma; never mix). Bridges a Supabase Auth user to a
// Prisma `User` row and loads the role + assigned centre ids.

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/security/rate-limit";

export type AdminRole = "ADMIN" | "SUPER_ADMIN";

export type AdminContext = {
  userId: string; // = Supabase Auth user id (UUID), matches User.id (invariant 12)
  role: AdminRole;
  centerIds: string[]; // centres this user administers (via UserCenter)
  ip: string | null; // client IP of the request that resolved this context (P4 — audit trail)
};

// Read the client IP from the current request headers (P4). getAdminContext is
// only ever called inside a request (route handlers / api/auth/me), so headers()
// is available; we tolerate its absence by returning null.
async function requestIp(): Promise<string | null> {
  try {
    const h = await headers();
    return clientIp({ headers: h });
  } catch {
    return null;
  }
}

// Verify the current Supabase session and resolve the admin context. Returns
// null when there is no authenticated user OR no matching Prisma User row (caller
// maps both to 401).
//
// P4 (C1-residual): we DO NOT auto-create a User row here anymore. The previous
// upsert minted a default role:"ADMIN" row on the first authenticated request,
// which meant any Supabase auth identity became an admin. The legitimate path is
// inviteUser() (SUPER_ADMIN-only), which creates the row with the chosen role at
// invite time — so a session with no row is treated as not-authorized, not as a
// new admin. Supabase self-signup is also disabled operationally (P1 C1).
//
// Decision C (edge auth): proxy.ts enforces session PRESENCE + abuse controls at
// the edge; the authoritative role/ownership check lives HERE / in the services
// (Prisma can't run in the edge runtime). Two layers by design — defence in depth.
export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { centers: true },
  });
  if (!dbUser) return null;

  // Keep the Prisma email in sync with the Supabase identity (an admin can change
  // it on the profile page) WITHOUT re-introducing auto-provisioning: update an
  // EXISTING row only, and only when it actually drifted. Best-effort — a failure
  // here never blocks auth. This keeps the user list / audit actor / password
  // reset from targeting a stale address.
  if (user.email && user.email !== dbUser.email) {
    try {
      await prisma.user.update({ where: { id: dbUser.id }, data: { email: user.email } });
    } catch {
      /* best-effort email resync */
    }
  }

  return {
    userId: dbUser.id,
    role: dbUser.role,
    centerIds: dbUser.centers.map((c) => c.centerId),
    ip: await requestIp(),
  };
}
