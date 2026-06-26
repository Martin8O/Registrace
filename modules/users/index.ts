// modules/users — SUPER_ADMIN-only user management (invariant 20). Bridges
// Supabase Auth (the source of identities + invite/reset emails — decision 5)
// and the Prisma User/UserCenter rows that carry role + centre assignment.
// Auth = Supabase, data = Prisma; never mixed (invariant 1).

import { prisma } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";
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

// User-management failure with an explicit HTTP status (P4 taxonomy): 403 wrong
// role · 404 user not found · 409 conflict (self-removal, email already taken) ·
// 422 a genuine provider rejection we can't classify. Handlers read `.status`
// (previously everything collapsed to 422).
export class UserManagementError extends Error {
  status: number;
  constructor(message = "User management operation failed", status = 422) {
    super(message);
    this.name = "UserManagementError";
    this.status = status;
  }
}

// Defence in depth: the routes already gate with requireSuperAdmin(), but every
// service re-asserts so the privilege can't be reached another way.
function assertSuperAdmin(ctx: AdminContext): void {
  if (ctx.role !== "SUPER_ADMIN") {
    throw new UserManagementError("SUPER_ADMIN only", 403);
  }
}

// SUPER_ADMIN sees all centres; an ADMIN's assignment is its centre list. The
// invite/update inputs ignore centerIds for a SUPER_ADMIN target.
function effectiveCenterIds(role: AdminUserRole, centerIds: string[]): string[] {
  return role === "SUPER_ADMIN" ? [] : centerIds;
}

// Where the Supabase invite + password-reset emails land. NOT the login page —
// an invited user has no password yet, and a reset needs to enter a NEW one. The
// /admin/set-password page consumes the token from the URL and calls
// updateUser({ password }). Built from NEXT_PUBLIC_APP_URL; the target must also
// be in Supabase Auth → URL Configuration → Redirect URLs (allowlist), or
// Supabase ignores it and falls back to the (possibly localhost) Site URL.
function passwordSetupRedirect(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return base ? `${base}/cs/admin/set-password` : undefined;
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
  const redirectTo = passwordSetupRedirect();
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(
    input.email,
    redirectTo ? { redirectTo } : undefined,
  );
  if (error || !data?.user) {
    // An email that already has an auth identity is a conflict (409). Prefer the
    // structured GoTrue error code over the free-text message (locale/version
    // independent), falling back to a substring match when no code is present.
    const message = error?.message ?? "Invite failed";
    const code = error?.code;
    const isConflict =
      code === "email_exists" ||
      code === "user_already_exists" ||
      (!code && /already|registered|exists|duplicate/i.test(message));
    throw new UserManagementError(message, isConflict ? 409 : 422);
  }

  const authUserId = data.user.id;
  const centerIds = effectiveCenterIds(input.role, input.centerIds);
  try {
    await prisma.$transaction(async (tx) => {
      // upsert (not create): a re-invite shouldn't fail on a pre-existing row.
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
  } catch {
    // The auth identity was created above but the Prisma rows failed (e.g. an
    // unknown centerId → FK error). Roll back the orphaned identity so the invite
    // stays retryable — otherwise (with the C1 fix: no auto-provision) the user
    // could accept the invite yet never resolve a role, and a re-invite would hit
    // "already registered". Mirrors removeUser's auth-first cleanup discipline.
    await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
    throw new UserManagementError(
      "Failed to provision the user (rolled back) — check the selected centres and retry.",
      422,
    );
  }

  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "user.invite",
    entityType: "User",
    entityId: authUserId,
    newData: { email: input.email, role: input.role, centerIds },
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

  const existing = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!existing) throw new UserManagementError("User not found", 404);

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

  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "user.update",
    entityType: "User",
    entityId: id,
    oldData: { role: existing.role },
    newData: { role: input.role, centerIds },
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
    throw new UserManagementError("Cannot remove your own account", 409);
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true } });
  if (!user) throw new UserManagementError("User not found", 404);
  // A super-admin can never be removed — not by themselves (above) and not by
  // another super-admin. Protects the top-level accounts (Martin's request).
  if (user.role === "SUPER_ADMIN") {
    throw new UserManagementError("A super-admin account cannot be removed", 403);
  }

  // Delete the auth identity first — if that fails (other than already-gone),
  // abort before touching Prisma so we don't leave a still-loginable account.
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error && !/not.?found/i.test(error.message)) {
    throw new UserManagementError(error.message);
  }

  await prisma.user.delete({ where: { id } });
  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "user.remove",
    entityType: "User",
    entityId: id,
    oldData: { email: user.email },
  });
  return { id };
}

// Send the user a password-reset email via Supabase Auth (its own email).
export async function resetUserPassword(
  id: string,
  ctx: AdminContext,
): Promise<{ sent: boolean; error?: string }> {
  assertSuperAdmin(ctx);

  const user = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  if (!user) throw new UserManagementError("User not found", 404);

  const supabase = createAdminClient();
  const redirectTo = passwordSetupRedirect();
  const { error } = await supabase.auth.resetPasswordForEmail(
    user.email,
    redirectTo ? { redirectTo } : undefined,
  );
  await logAuditEvent({
    userId: ctx.userId,
    ip: ctx.ip,
    action: "user.password_reset",
    entityType: "User",
    entityId: id,
    newData: { sent: !error, to: user.email },
  });
  if (error) return { sent: false, error: error.message };
  return { sent: true };
}
