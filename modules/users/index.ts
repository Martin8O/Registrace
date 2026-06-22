// modules/users — SUPER_ADMIN-only user management (invariant 20). Bridges
// Supabase Auth (the source of identities + invite/reset emails — decision 5)
// and the Prisma User/UserCenter rows that carry role + centre assignment.
// Auth = Supabase, data = Prisma; never mixed (invariant 1).

import { prisma } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminContext } from "@/modules/auth";
import type { UserInviteInput, UserUpdateInput } from "@/lib/validation";

export type AdminUserRole = "SUPER_ADMIN" | "ADMIN";

export type AdminUserListItem = {
  id: string;
  email: string;
  role: AdminUserRole;
  createdAt: string; // UTC ISO
  assignedCenters: { id: string; name_cs: string; name_en: string }[];
};

// Invite / reset that the Supabase side rejects (e.g. the email already has an
// auth user) → handlers map to 422 with the provider message.
export class UserManagementError extends Error {
  constructor(message = "User management operation failed") {
    super(message);
    this.name = "UserManagementError";
  }
}

// Defence in depth: the routes already gate with requireSuperAdmin(), but every
// service re-asserts so the privilege can't be reached another way.
function assertSuperAdmin(ctx: AdminContext): void {
  if (ctx.role !== "SUPER_ADMIN") {
    throw new UserManagementError("SUPER_ADMIN only");
  }
}

// SUPER_ADMIN sees all centres; an ADMIN's assignment is its centre list. The
// invite/update inputs ignore centerIds for a SUPER_ADMIN target.
function effectiveCenterIds(role: AdminUserRole, centerIds: string[]): string[] {
  return role === "SUPER_ADMIN" ? [] : centerIds;
}

function loginRedirect(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return base ? `${base}/cs/admin/login` : undefined;
}

export async function listUsers(ctx: AdminContext): Promise<AdminUserListItem[]> {
  assertSuperAdmin(ctx);
  const users = await prisma.user.findMany({
    include: { centers: { include: { center: true } } },
    orderBy: { createdAt: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    assignedCenters: u.centers.map((uc) => ({
      id: uc.center.id,
      name_cs: uc.center.name_cs,
      name_en: uc.center.name_en,
    })),
  }));
}

// Invite a new admin: create the Supabase auth user + send the invite email
// (Supabase's own email — not Resend, so not subject to the Resend test-mode
// limit), then create the Prisma User row with the chosen role + centre rows.
export async function inviteUser(
  input: UserInviteInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  assertSuperAdmin(ctx);

  const supabase = createAdminClient();
  const redirectTo = loginRedirect();
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(
    input.email,
    redirectTo ? { redirectTo } : undefined,
  );
  if (error || !data?.user) {
    throw new UserManagementError(error?.message ?? "Invite failed");
  }

  const authUserId = data.user.id;
  const centerIds = effectiveCenterIds(input.role, input.centerIds);
  await prisma.$transaction(async (tx) => {
    // upsert (not create): getAdminContext upserts a User on first login, and a
    // re-invite shouldn't fail on a pre-existing row.
    await tx.user.upsert({
      where: { id: authUserId },
      update: { email: input.email, role: input.role },
      create: { id: authUserId, email: input.email, role: input.role },
    });
    await tx.userCenter.deleteMany({ where: { userId: authUserId } });
    if (centerIds.length > 0) {
      await tx.userCenter.createMany({
        data: centerIds.map((centerId) => ({ userId: authUserId, centerId })),
        skipDuplicates: true,
      });
    }
  });

  return { id: authUserId };
}

// Change an existing user's role + replace their centre assignment in one txn.
export async function updateUser(
  id: string,
  input: UserUpdateInput,
  ctx: AdminContext,
): Promise<{ id: string }> {
  assertSuperAdmin(ctx);

  const centerIds = effectiveCenterIds(input.role, input.centerIds);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { role: input.role } });
    await tx.userCenter.deleteMany({ where: { userId: id } });
    if (centerIds.length > 0) {
      await tx.userCenter.createMany({
        data: centerIds.map((centerId) => ({ userId: id, centerId })),
        skipDuplicates: true,
      });
    }
  });

  return { id };
}

// Remove an admin entirely: delete the Supabase auth identity (they can no
// longer sign in) AND the Prisma User row. The DB handles the rest via FK
// actions: UserCenter rows CASCADE-delete, any events they created have
// createdBy SET NULL (the events survive, just unowned → SUPER_ADMIN-managed),
// AuditLog.userId SET NULL. SUPER_ADMIN only; cannot remove yourself.
export async function removeUser(id: string, ctx: AdminContext): Promise<{ id: string }> {
  assertSuperAdmin(ctx);
  if (id === ctx.userId) {
    throw new UserManagementError("Cannot remove your own account");
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw new UserManagementError("User not found");

  // Delete the auth identity first — if that fails (other than already-gone),
  // abort before touching Prisma so we don't leave a still-loginable account.
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error && !/not.?found/i.test(error.message)) {
    throw new UserManagementError(error.message);
  }

  await prisma.user.delete({ where: { id } });
  return { id };
}

// Send the user a password-reset email via Supabase Auth (its own email).
export async function resetUserPassword(
  id: string,
  ctx: AdminContext,
): Promise<{ sent: boolean; error?: string }> {
  assertSuperAdmin(ctx);

  const user = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  if (!user) throw new UserManagementError("User not found");

  const supabase = createAdminClient();
  const redirectTo = loginRedirect();
  const { error } = await supabase.auth.resetPasswordForEmail(
    user.email,
    redirectTo ? { redirectTo } : undefined,
  );
  if (error) return { sent: false, error: error.message };
  return { sent: true };
}
